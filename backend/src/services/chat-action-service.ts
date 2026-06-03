import {
  ChatAction,
  type ChatActionType,
  type IChatActionDocument
} from '../models/chat-action.js'

export interface ReserveChatActionInput {
  channelId: string
  platform: ChatPlatform
  messageId: string
  liveChatId: string
  authorExternalId: string
  type: ChatActionType
  qnaEntryId?: string | null
  catalogId?: string | null
  reason?: string | null
  request?: unknown
}

export type ReserveChatActionResult =
  | {
      reserved: true
      action: IChatActionDocument
    }
  | {
      reserved: false
      action: IChatActionDocument
    }

function isDuplicateKeyError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false
  }

  const err = error as Record<string, unknown>

  if (err.code === 11000 || err.code === '11000') {
    return true
  }

  return (
    typeof err.message === 'string' &&
    err.message.toLowerCase().includes('duplicate key')
  )
}

export async function reserveChatAction(
  input: ReserveChatActionInput
): Promise<ReserveChatActionResult> {
  try {
    const action = await ChatAction.create({
      channelId: input.channelId,
      platform: input.platform,
      messageId: input.messageId,
      liveChatId: input.liveChatId,
      authorExternalId: input.authorExternalId,
      type: input.type,
      status: 'pending',
      qnaEntryId: input.qnaEntryId ?? null,
      catalogId: input.catalogId ?? null,
      reason: input.reason ?? null,
      request: input.request,
      error: null
    })

    return { reserved: true, action }
  } catch (error) {
    if (!isDuplicateKeyError(error)) {
      throw error
    }

    const existing = await ChatAction.findOne({
      platform: input.platform,
      messageId: input.messageId,
      type: input.type
    }).exec()

    if (!existing) {
      throw error
    }

    return { reserved: false, action: existing }
  }
}

export async function markChatActionSucceeded(
  actionId: unknown,
  response: unknown
): Promise<void> {
  await ChatAction.findByIdAndUpdate(actionId, {
    status: 'succeeded',
    response,
    error: null
  }).exec()
}

export async function markChatActionFailed(
  actionId: unknown,
  error: unknown
): Promise<void> {
  await ChatAction.findByIdAndUpdate(actionId, {
    status: 'failed',
    error: error instanceof Error ? error.message : String(error)
  }).exec()
}
