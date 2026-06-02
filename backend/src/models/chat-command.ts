import { Schema, model, type Document } from 'mongoose'

export interface IChatCommand {
  channelId: string
  trigger: string
  normalizedTrigger: string
  replyText: string
  enabled: boolean
  createdAt: Date
  updatedAt: Date
}

export type IChatCommandDocument = Document<unknown, object, IChatCommand> &
  IChatCommand

const chatCommandSchema = new Schema<IChatCommand>(
  {
    channelId: { type: String, required: true },
    trigger: { type: String, required: true },
    normalizedTrigger: { type: String, required: true },
    replyText: { type: String, required: true },
    enabled: { type: Boolean, default: true }
  },
  { timestamps: true }
)

chatCommandSchema.index(
  { channelId: 1, normalizedTrigger: 1 },
  { unique: true }
)
chatCommandSchema.index({ channelId: 1, createdAt: -1 })

export const ChatCommand = model<IChatCommand>('ChatCommand', chatCommandSchema)
