import { Schema, model, type Document } from 'mongoose'

export interface IModerationCatalog {
  catalogId: string
  label: string
  definition: string
  createdAt: Date
  updatedAt: Date
}

export type IModerationCatalogDocument = Document<unknown, object, IModerationCatalog> &
  IModerationCatalog

const moderationCatalogSchema = new Schema<IModerationCatalog>(
  {
    catalogId: { type: String, required: true },
    label: { type: String, required: true },
    definition: { type: String, required: true }
  },
  { timestamps: true }
)

moderationCatalogSchema.index({ catalogId: 1 }, { unique: true })

export const ModerationCatalog = model<IModerationCatalog>(
  'ModerationCatalog',
  moderationCatalogSchema
)
