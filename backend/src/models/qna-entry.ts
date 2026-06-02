import { Schema, model, type Document } from 'mongoose'

export interface IQnaEntry {
  channelId: string
  question: string
  normalizedQuestion: string
  answer: string
  enabled: boolean
  createdAt: Date
  updatedAt: Date
}

export type IQnaEntryDocument = Document<unknown, object, IQnaEntry> & IQnaEntry

const qnaEntrySchema = new Schema<IQnaEntry>(
  {
    channelId: { type: String, required: true },
    question: { type: String, required: true },
    normalizedQuestion: { type: String, required: true },
    answer: { type: String, required: true },
    enabled: { type: Boolean, default: true }
  },
  { timestamps: true }
)

qnaEntrySchema.index(
  { channelId: 1, normalizedQuestion: 1 },
  { unique: true }
)

export const QnaEntry = model<IQnaEntry>('QnaEntry', qnaEntrySchema)
