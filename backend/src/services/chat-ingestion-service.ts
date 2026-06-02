import {
  ChatEvent,
  isValidChatPlatform,
  type ChatPlatform,
  type IChatEventDocument
} from '../models/chat-event.js'
import {
  runQnaAgentWorkflow,
  type QnaAgentResult,
  type RunQnaAgentInput
} from './qna-agent-service.js'
import {
  runEvoModerationWorkflow,
  type EvoModerationResult,
  type RunEvoModerationInput
} from './evo-moderation-service.js'
import {
  matchChatCommand,
  type ChatCommandMatchResult,
  type MatchChatCommandInput
} from './chat-command-service.js'
import { normalizeQuestionText } from './qna-service.js'

export interface ChatIngestionInput {
  channelId: string
  messageId: string
  authorExternalId: string
  channelExternalId: string
  platform: ChatPlatform
  sentAt: string
  text: string
  skipQna?: boolean
}

export interface ChatIngestionFreshResult {
  duplicate: false
  event: IChatEventDocument
  commandResult: ChatCommandMatchResult
  qnaResult: QnaAgentResult
  moderationResult: EvoModerationResult
}

export interface ChatIngestionDuplicateResult {
  duplicate: true
  event: IChatEventDocument
  commandResult: null
  qnaResult: null
  moderationResult: null
}

export type ChatIngestionResult =
  | ChatIngestionFreshResult
  | ChatIngestionDuplicateResult

export interface ChatIngestionDependencies {
  matchChatCommand: (input: MatchChatCommandInput) => Promise<ChatCommandMatchResult>
  runQnaAgentWorkflow: (input: RunQnaAgentInput) => Promise<QnaAgentResult>
  runEvoModerationWorkflow: (input: RunEvoModerationInput) => Promise<EvoModerationResult>
}

export type ChatIngestionValidationErrorCode =
  | 'INVALID_CHANNEL_ID'
  | 'INVALID_MESSAGE_ID'
  | 'INVALID_AUTHOR_EXTERNAL_ID'
  | 'INVALID_CHANNEL_EXTERNAL_ID'
  | 'INVALID_PLATFORM'
  | 'INVALID_SENT_AT'
  | 'INVALID_TEXT'

export class ChatIngestionValidationError extends Error {
  public readonly code: ChatIngestionValidationErrorCode

  constructor(message: string, code: ChatIngestionValidationErrorCode) {
    super(message)
    this.name = 'ChatIngestionValidationError'
    this.code = code
  }
}

function getDefaultDependencies(): ChatIngestionDependencies {
  return {
    matchChatCommand,
    runQnaAgentWorkflow,
    runEvoModerationWorkflow
  }
}

function requireNonEmptyString(
  field: string,
  value: unknown,
  code: ChatIngestionValidationErrorCode
): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ChatIngestionValidationError(
      `${field} must be a non-empty string`,
      code
    )
  }

  return value.trim()
}

function normalizeInput(input: ChatIngestionInput) {
  const channelId = requireNonEmptyString(
    'channelId',
    input.channelId,
    'INVALID_CHANNEL_ID'
  )
  const messageId = requireNonEmptyString(
    'messageId',
    input.messageId,
    'INVALID_MESSAGE_ID'
  )
  const authorExternalId = requireNonEmptyString(
    'authorExternalId',
    input.authorExternalId,
    'INVALID_AUTHOR_EXTERNAL_ID'
  )
  const channelExternalId = requireNonEmptyString(
    'channelExternalId',
    input.channelExternalId,
    'INVALID_CHANNEL_EXTERNAL_ID'
  )
  const sentAtRaw = requireNonEmptyString(
    'sentAt',
    input.sentAt,
    'INVALID_SENT_AT'
  )
  const text = requireNonEmptyString('text', input.text, 'INVALID_TEXT')

  if (!isValidChatPlatform(input.platform)) {
    throw new ChatIngestionValidationError(
      'platform must be one of: youtube, twitch, kick',
      'INVALID_PLATFORM'
    )
  }

  const sentAt = new Date(sentAtRaw)

  if (Number.isNaN(sentAt.valueOf())) {
    throw new ChatIngestionValidationError(
      'sentAt must be a valid date string',
      'INVALID_SENT_AT'
    )
  }

  return {
    channelId,
    messageId,
    authorExternalId,
    channelExternalId,
    platform: input.platform,
    sentAt,
    text,
    skipQna: input.skipQna === true
  }
}

function isDuplicateKeyError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false
  }

  const err = error as Record<string, unknown>

  if (err.code === 11000 || err.code === '11000') {
    return true
  }

  if (typeof err.message === 'string') {
    const message = err.message.toLowerCase()
    return message.includes('e11000') || message.includes('duplicate key')
  }

  return false
}

export async function ingestChat(
  input: ChatIngestionInput,
  dependencies: ChatIngestionDependencies = getDefaultDependencies()
): Promise<ChatIngestionResult> {
  const normalized = normalizeInput(input)

  let event: IChatEventDocument

  try {
    event = await ChatEvent.create({
      channelId: normalized.channelId,
      messageId: normalized.messageId,
      authorExternalId: normalized.authorExternalId,
      channelExternalId: normalized.channelExternalId,
      platform: normalized.platform,
      sentAt: normalized.sentAt,
      text: normalized.text
    })
  } catch (error) {
    if (!isDuplicateKeyError(error)) {
      throw error
    }

    const existing = await ChatEvent.findOne({
      platform: normalized.platform,
      messageId: normalized.messageId
    }).exec()

    if (!existing) {
      throw error
    }

    console.info('Skipping duplicate chat message', {
      channelId: normalized.channelId,
      platform: normalized.platform,
      messageId: normalized.messageId
    })

    return {
      duplicate: true,
      event: existing,
      commandResult: null,
      qnaResult: null,
      moderationResult: null
    }
  }

  try {
    const commandResult = await dependencies.matchChatCommand({
      channelId: normalized.channelId,
      messageText: normalized.text
    })

    const qnaPromise: Promise<QnaAgentResult> = normalized.skipQna
      ? Promise.resolve({
          agent: 'qna',
          matched: false,
          action: 'DO_NOTHING',
          workflow: {
            receivedMessage: true,
            retrievedEntries: 0,
            retrievedQnaEntries: [],
            normalizedMessage: normalizeQuestionText(normalized.text),
            promptRendered: false,
            decision: 'DO_NOTHING',
            reason: 'HISTORY_SKIPPED'
          }
        })
      : dependencies.runQnaAgentWorkflow({
          channelId: normalized.channelId,
          messageText: normalized.text
        })

    const [qnaResult, moderationResult] = await Promise.all([
      qnaPromise,
      dependencies.runEvoModerationWorkflow({
        channelId: normalized.channelId,
        message: normalized.text
      })
    ])

    return {
      duplicate: false,
      event,
      commandResult,
      qnaResult,
      moderationResult
    }
  } catch (error) {
    await ChatEvent.findOneAndDelete({ _id: event._id }).exec()
    throw error
  }
}
