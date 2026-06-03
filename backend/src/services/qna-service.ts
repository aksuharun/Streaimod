import {
  QnaEntry,
  type IQnaEntry,
  type IQnaEntryDocument
} from '../models/qna-entry.js'

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i
const LEADING_QUESTION_MARK_PATTERN = /^[?\u00BF\uFF1F]+/
const TRAILING_QUESTION_PUNCTUATION_PATTERN = /[?!\u00BF\uFF01\uFF1F]*[?\u00BF\uFF1F][?!\u00BF\uFF01\uFF1F]*$/
const COMBINING_MARKS_PATTERN = /[\u0300-\u036f]/g
const TURKISH_DOTLESS_I_PATTERN = /\u0131/g

function isValidObjectId(value: string): boolean {
  return OBJECT_ID_PATTERN.test(value)
}

export function normalizeQuestionText(input: string): string {
  return input
    .trim()
    .normalize('NFD')
    .replace(COMBINING_MARKS_PATTERN, '')
    .replace(TURKISH_DOTLESS_I_PATTERN, 'i')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(LEADING_QUESTION_MARK_PATTERN, '')
    .replace(TRAILING_QUESTION_PUNCTUATION_PATTERN, '')
    .trim()
}

function isDuplicateKeyError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const err = error as Record<string, unknown>

  // MongoDB / Mongoose: code 11000 for duplicate key
  if (err.code === 11000 || err.code === '11000') return true

  // memgoose: may throw a named DuplicateKeyError
  if (err.name === 'DuplicateKeyError') return true

  // Fallback: check message patterns for MongoDB-style duplicate key errors
  if (typeof err.message === 'string') {
    const msg = err.message.toLowerCase()
    if (msg.includes('e11000') || msg.includes('duplicate key')) return true
  }

  return false
}

export class QnaServiceError extends Error {
  public readonly code:
    | 'NORMALIZED_EMPTY'
    | 'DUPLICATE_QUESTION'
    | 'DUPLICATE_IMPORT_QUESTION'

  constructor(
    message: string,
    code:
      | 'NORMALIZED_EMPTY'
      | 'DUPLICATE_QUESTION'
      | 'DUPLICATE_IMPORT_QUESTION'
  ) {
    super(message)
    this.name = 'QnaServiceError'
    this.code = code
  }
}

export interface CreateEntryInput {
  channelId: string
  question: string
  answer: string
  enabled?: boolean
}

export async function createEntry(
  input: CreateEntryInput
): Promise<IQnaEntryDocument> {
  const channelId = input.channelId.trim()
  const normalizedQuestion = normalizeQuestionText(input.question)

  if (normalizedQuestion.length === 0) {
    throw new QnaServiceError(
      'Question resolves to an empty value after normalization',
      'NORMALIZED_EMPTY'
    )
  }

  const existing = await QnaEntry.findOne({
    channelId,
    normalizedQuestion
  }).exec()

  if (existing) {
    throw new QnaServiceError(
      'An entry with this question already exists in this channel',
      'DUPLICATE_QUESTION'
    )
  }

  try {
    return await QnaEntry.create({
      channelId,
      question: input.question.trim(),
      normalizedQuestion,
      answer: input.answer.trim(),
      enabled: input.enabled ?? true
    })
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new QnaServiceError(
        'An entry with this question already exists in this channel',
        'DUPLICATE_QUESTION'
      )
    }
    throw error
  }
}

export async function listEntries(
  channelId?: string
): Promise<IQnaEntryDocument[]> {
  const trimmed = channelId?.trim()
  const filter: Record<string, unknown> = {}

  if (trimmed) {
    filter.channelId = trimmed
  }

  return QnaEntry.find(filter).sort({ createdAt: -1 }).exec()
}

export async function getEntry(
  id: string
): Promise<IQnaEntryDocument | null> {
  if (!isValidObjectId(id)) {
    return null
  }

  return QnaEntry.findOne({ _id: id }).exec()
}

export interface UpdateEntryInput {
  question?: string
  answer?: string
  enabled?: boolean
}

export interface BulkImportEntryInput {
  question: string
  answer: string
  enabled?: boolean
}

export interface BulkImportResult {
  createdCount: number
  updatedCount: number
  unchangedCount: number
  totalCount: number
  entries: IQnaEntryDocument[]
}

export async function updateEntry(
  id: string,
  input: UpdateEntryInput
): Promise<IQnaEntryDocument | null> {
  if (!isValidObjectId(id)) {
    return null
  }

  const existing = await QnaEntry.findOne({ _id: id }).exec()

  if (!existing) {
    return null
  }

  const updateData: Record<string, unknown> = {}

  if (input.question !== undefined) {
    const trimmedQuestion = input.question.trim()
    const normalizedQuestion = normalizeQuestionText(trimmedQuestion)

    if (normalizedQuestion.length === 0) {
      throw new QnaServiceError(
        'Question resolves to an empty value after normalization',
        'NORMALIZED_EMPTY'
      )
    }

    if (normalizedQuestion !== existing.normalizedQuestion) {
      const duplicate = await QnaEntry.findOne({
        channelId: existing.channelId,
        normalizedQuestion,
        _id: { $ne: existing._id }
      }).exec()

      if (duplicate) {
        throw new QnaServiceError(
          'An entry with this question already exists in this channel',
          'DUPLICATE_QUESTION'
        )
      }
    }

    updateData.question = trimmedQuestion
    updateData.normalizedQuestion = normalizedQuestion
  }

  if (input.answer !== undefined) {
    updateData.answer = input.answer.trim()
  }

  if (input.enabled !== undefined) {
    updateData.enabled = input.enabled
  }

  try {
    return await QnaEntry.findOneAndUpdate(
      { _id: id },
      { $set: updateData },
      { new: true }
    ).exec()
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new QnaServiceError(
        'An entry with this question already exists in this channel',
        'DUPLICATE_QUESTION'
      )
    }
    throw error
  }
}

export async function deleteEntry(id: string): Promise<boolean> {
  if (!isValidObjectId(id)) {
    return false
  }

  const result = await QnaEntry.findOneAndDelete({ _id: id }).exec()

  return result !== null
}

export async function importEntries(
  channelId: string,
  entries: BulkImportEntryInput[]
): Promise<BulkImportResult> {
  const trimmedChannelId = channelId.trim()
  const normalizedEntries = entries.map((entry, index) => {
    const trimmedQuestion = entry.question.trim()
    const normalizedQuestion = normalizeQuestionText(trimmedQuestion)

    if (normalizedQuestion.length === 0) {
      throw new QnaServiceError(
        `Entry ${index + 1} question resolves to an empty value after normalization`,
        'NORMALIZED_EMPTY'
      )
    }

    return {
      question: trimmedQuestion,
      normalizedQuestion,
      answer: entry.answer.trim(),
      enabled: entry.enabled ?? true
    }
  })

  const payloadQuestionIndexes = new Map<string, number>()

  for (const [index, entry] of normalizedEntries.entries()) {
    const duplicateIndex = payloadQuestionIndexes.get(entry.normalizedQuestion)

    if (duplicateIndex !== undefined) {
      throw new QnaServiceError(
        `Entries ${duplicateIndex + 1} and ${index + 1} resolve to the same normalized question`,
        'DUPLICATE_IMPORT_QUESTION'
      )
    }

    payloadQuestionIndexes.set(entry.normalizedQuestion, index)
  }

  const existingEntries = await QnaEntry.find({
    channelId: trimmedChannelId,
    normalizedQuestion: {
      $in: normalizedEntries.map((entry) => entry.normalizedQuestion)
    }
  }).exec()

  const existingByNormalized = new Map(
    existingEntries.map((entry) => [entry.normalizedQuestion, entry] as const)
  )

  const savedEntries: IQnaEntryDocument[] = []
  let createdCount = 0
  let updatedCount = 0
  let unchangedCount = 0

  for (const entry of normalizedEntries) {
    const existing = existingByNormalized.get(entry.normalizedQuestion)

    if (!existing) {
      const created = await QnaEntry.create({
        channelId: trimmedChannelId,
        question: entry.question,
        normalizedQuestion: entry.normalizedQuestion,
        answer: entry.answer,
        enabled: entry.enabled
      })

      existingByNormalized.set(entry.normalizedQuestion, created)
      savedEntries.push(created)
      createdCount += 1
      continue
    }

    const changed =
      existing.question !== entry.question ||
      existing.answer !== entry.answer ||
      existing.enabled !== entry.enabled

    if (!changed) {
      savedEntries.push(existing)
      unchangedCount += 1
      continue
    }

    const updated = await QnaEntry.findOneAndUpdate(
      { _id: existing._id },
      {
        $set: {
          question: entry.question,
          answer: entry.answer,
          enabled: entry.enabled
        }
      },
      { new: true }
    ).exec()

    if (!updated) {
      throw new Error('Q&A entry disappeared during bulk import')
    }

    existingByNormalized.set(entry.normalizedQuestion, updated)
    savedEntries.push(updated)
    updatedCount += 1
  }

  return {
    createdCount,
    updatedCount,
    unchangedCount,
    totalCount: normalizedEntries.length,
    entries: savedEntries
  }
}
