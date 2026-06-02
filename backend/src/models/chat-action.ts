import { Schema, model, type Document } from 'mongoose'

import { CHAT_PLATFORM_VALUES, type ChatPlatform } from './chat-event.js'

export const CHAT_ACTION_TYPES = ['qna_reply', 'command_reply', 'ban', 'timeout'] as const
export type ChatActionType = (typeof CHAT_ACTION_TYPES)[number]

export const CHAT_ACTION_STATUSES = ['pending', 'succeeded', 'failed'] as const
export type ChatActionStatus = (typeof CHAT_ACTION_STATUSES)[number]

export interface IChatAction {
  channelId: string
  platform: ChatPlatform
  messageId: string
  liveChatId: string
  authorExternalId: string
  type: ChatActionType
  status: ChatActionStatus
  qnaEntryId?: string | null
  catalogId?: string | null
  reason?: string | null
  request?: unknown
  response?: unknown
  error?: string | null
  createdAt: Date
  updatedAt: Date
}

export type IChatActionDocument = Document<unknown, object, IChatAction> &
  IChatAction

const chatActionSchema = new Schema<IChatAction>(
  {
    channelId: { type: String, required: true },
    platform: {
      type: String,
      enum: CHAT_PLATFORM_VALUES,
      required: true
    },
    messageId: { type: String, required: true },
    liveChatId: { type: String, required: true },
    authorExternalId: { type: String, required: true },
    type: {
      type: String,
      enum: CHAT_ACTION_TYPES,
      required: true
    },
    status: {
      type: String,
      enum: CHAT_ACTION_STATUSES,
      default: 'pending',
      required: true
    },
    qnaEntryId: { type: String, default: null },
    catalogId: { type: String, default: null },
    reason: { type: String, default: null },
    request: { type: Schema.Types.Mixed, required: false },
    response: { type: Schema.Types.Mixed, required: false },
    error: { type: String, default: null }
  },
  { timestamps: true }
)

chatActionSchema.index(
  { platform: 1, messageId: 1, type: 1 },
  { unique: true }
)
chatActionSchema.index({ channelId: 1, createdAt: -1 })

export const ChatAction = model<IChatAction>('ChatAction', chatActionSchema)
