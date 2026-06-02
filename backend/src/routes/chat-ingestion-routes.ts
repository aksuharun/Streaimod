import { type Application, type Express, Router } from 'express'

import type { IChatCommandDocument } from '../models/chat-command.js'
import {
  CHAT_PLATFORM_VALUES,
  isValidChatPlatform
} from '../models/chat-event.js'
import type { IQnaEntryDocument } from '../models/qna-entry.js'
import {
  type QnaAgentDependencies,
  type QnaAgentResult
} from '../services/qna-agent-service.js'
import { runQnaAgentWorkflow } from '../services/qna-agent-service.js'
import {
  type EvoModerationDependencies,
  type EvoModerationResult
} from '../services/evo-moderation-service.js'
import { runEvoModerationWorkflow } from '../services/evo-moderation-service.js'
import {
  ChatIngestionValidationError,
  ingestChat,
  type ChatIngestionResult
} from '../services/chat-ingestion-service.js'
import {
  matchChatCommand,
  type ChatCommandMatchResult
} from '../services/chat-command-service.js'

const router = Router()

// ---------------------------------------------------------------------------
// App.locals helpers – reuse the exact same keys as the existing routes
// ---------------------------------------------------------------------------

interface QnaLocals {
  qnaAgentDependencies?: QnaAgentDependencies
}

interface ModerationLocals {
  evoModerationDependencies?: EvoModerationDependencies
}

function getQnaAgentDependencies(app: Application): QnaAgentDependencies | undefined {
  return (app.locals as QnaLocals).qnaAgentDependencies
}

function getEvoModerationDependencies(
  app: Application
): EvoModerationDependencies | undefined {
  return (app.locals as ModerationLocals).evoModerationDependencies
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

// ---------------------------------------------------------------------------
// DTO helpers
// ---------------------------------------------------------------------------

function toEntryDto(doc: IQnaEntryDocument) {
  return {
    id: String(doc._id),
    channelId: doc.channelId,
    question: doc.question,
    normalizedQuestion: doc.normalizedQuestion,
    answer: doc.answer,
    enabled: doc.enabled,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  }
}

function toQnaDto(result: QnaAgentResult) {
  if (!result.matched) {
    return {
      agent: result.agent,
      matched: false as const,
      action: result.action,
      workflow: result.workflow
    }
  }

  return {
    agent: result.agent,
    matched: true as const,
    action: result.action,
    answer: result.answer,
    entry: toEntryDto(result.entry),
    workflow: result.workflow
  }
}

function toModerationDto(result: EvoModerationResult) {
  return {
    agent: result.agent,
    action: result.action,
    catalogId: result.catalogId,
    reason: result.reason,
    stage: result.stage,
    workflow: result.workflow
  }
}

function toChatCommandDto(doc: IChatCommandDocument) {
  return {
    id: String(doc._id),
    channelId: doc.channelId,
    trigger: doc.trigger,
    replyText: doc.replyText,
    enabled: doc.enabled,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  }
}

function toCommandDto(result: ChatCommandMatchResult) {
  if (!result.matched) {
    return {
      matched: false as const
    }
  }

  return {
    matched: true as const,
    replyText: result.replyText,
    command: toChatCommandDto(result.command)
  }
}

function toEventDto(event: NonNullable<ChatIngestionResult['event']>) {
  return {
    id: String(event._id),
    channelId: event.channelId,
    messageId: event.messageId,
    authorExternalId: event.authorExternalId,
    channelExternalId: event.channelExternalId,
    platform: event.platform,
    sentAt: event.sentAt,
    text: event.text,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt
  }
}

// ---------------------------------------------------------------------------
// POST /api/chat/ingest
// ---------------------------------------------------------------------------

router.post('/ingest', async (request_, response, next) => {
  try {
    const body = request_.body as Record<string, unknown> | undefined

    if (!body || typeof body !== 'object') {
      response.status(400).json({ error: 'Request body is required' })
      return
    }

    const {
      channelId,
      messageId,
      authorExternalId,
      channelExternalId,
      platform,
      sentAt,
      text,
      skipQna
    } = body

    if (!isNonEmptyString(channelId)) {
      response
        .status(400)
        .json({ error: 'channelId is required and must be a non-empty string' })
      return
    }

    if (!isNonEmptyString(messageId)) {
      response
        .status(400)
        .json({ error: 'messageId is required and must be a non-empty string' })
      return
    }

    if (!isNonEmptyString(authorExternalId)) {
      response
        .status(400)
        .json({ error: 'authorExternalId is required and must be a non-empty string' })
      return
    }

    if (!isNonEmptyString(channelExternalId)) {
      response
        .status(400)
        .json({ error: 'channelExternalId is required and must be a non-empty string' })
      return
    }

    if (!isValidChatPlatform(platform)) {
      response
        .status(400)
        .json({
          error: `platform is required and must be one of: ${CHAT_PLATFORM_VALUES.join(', ')}`
        })
      return
    }

    if (!isNonEmptyString(sentAt)) {
      response
        .status(400)
        .json({ error: 'sentAt is required and must be a non-empty string' })
      return
    }

    if (!isNonEmptyString(text)) {
      response
        .status(400)
        .json({ error: 'text is required and must be a non-empty string' })
      return
    }

    const result = await ingestChat(
      {
        channelId: channelId as string,
        messageId: messageId as string,
        authorExternalId: authorExternalId as string,
        channelExternalId: channelExternalId as string,
        platform,
        sentAt: sentAt as string,
        text: text as string,
        skipQna: skipQna === true
      },
      {
        matchChatCommand: (input) => matchChatCommand(input),
        runQnaAgentWorkflow: (input) =>
          runQnaAgentWorkflow(input, getQnaAgentDependencies(request_.app)),
        runEvoModerationWorkflow: (input) =>
          runEvoModerationWorkflow(input, getEvoModerationDependencies(request_.app))
      }
    )

    const statusCode = result.duplicate ? 200 : 201

    response.status(statusCode).json({
      duplicate: result.duplicate,
      event: result.event ? toEventDto(result.event) : null,
      command: result.commandResult ? toCommandDto(result.commandResult) : null,
      qna: result.qnaResult ? toQnaDto(result.qnaResult) : null,
      moderation: result.moderationResult
        ? toModerationDto(result.moderationResult)
        : null
    })
  } catch (error) {
    if (error instanceof ChatIngestionValidationError) {
      response.status(400).json({ error: error.message })
      return
    }

    next(error)
  }
})

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerChatIngestionRoutes(app: Express): void {
  app.use('/api/chat', router)
}
