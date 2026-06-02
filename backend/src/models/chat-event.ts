import { Schema, model, type Document } from 'mongoose'

export const CHAT_PLATFORM_VALUES = ['youtube', 'twitch', 'kick'] as const
export type ChatPlatform = (typeof CHAT_PLATFORM_VALUES)[number]

export function isValidChatPlatform(value: unknown): value is ChatPlatform {
  return typeof value === 'string' && CHAT_PLATFORM_VALUES.includes(value as ChatPlatform)
}

export interface IChatEvent {
  channelId: string
  messageId: string
  authorExternalId: string
  channelExternalId: string
  platform: ChatPlatform
  sentAt: Date
  text: string
  createdAt: Date
  updatedAt: Date
}

export type IChatEventDocument = Document<unknown, object, IChatEvent> &
  IChatEvent

const chatEventSchema = new Schema<IChatEvent>(
  {
    channelId: { type: String, required: true },
    messageId: { type: String, required: true },
    authorExternalId: { type: String, required: true },
    channelExternalId: { type: String, required: true },
    platform: {
      type: String,
      required: true,
      enum: CHAT_PLATFORM_VALUES
    },
    sentAt: { type: Date, required: true },
    text: { type: String, required: true }
  },
  { timestamps: true }
)

chatEventSchema.index(
  { platform: 1, messageId: 1 },
  { unique: true }
)

export const ChatEvent = model<IChatEvent>('ChatEvent', chatEventSchema)
