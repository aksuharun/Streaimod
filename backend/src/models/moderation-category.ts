import { Schema, model, type Document } from 'mongoose'

export type ModerationCategoryType = 'ban' | 'timeout'

export interface IModerationCategory {
  channelId: string
  catalogId: string
  type: ModerationCategoryType
  label: string
  normalizedLabel: string
  definition: string
  enabled: boolean
  createdAt: Date
  updatedAt: Date
}

export type IModerationCategoryDocument = Document<unknown, object, IModerationCategory> &
  IModerationCategory

const moderationCategorySchema = new Schema<IModerationCategory>(
  {
    channelId: { type: String, required: true },
    catalogId: { type: String, required: true },
    type: {
      type: String,
      required: true,
      enum: ['ban', 'timeout']
    },
    label: { type: String, required: true },
    normalizedLabel: { type: String, required: true },
    definition: { type: String, required: true },
    enabled: { type: Boolean, default: true }
  },
  { timestamps: true }
)

moderationCategorySchema.index(
  { channelId: 1, type: 1, normalizedLabel: 1 },
  { unique: true }
)

moderationCategorySchema.index({ channelId: 1, catalogId: 1 }, { unique: true })

export const ModerationCategory = model<IModerationCategory>(
  'ModerationCategory',
  moderationCategorySchema
)
