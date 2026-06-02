import {
  ModerationCatalog,
  type IModerationCatalogDocument
} from '../models/moderation-catalog.js'
import {
  ModerationCategory,
  type IModerationCategory,
  type IModerationCategoryDocument,
  type ModerationCategoryType
} from '../models/moderation-category.js'
import { hasModerationCatalogEntry, normalizeCatalogId } from './moderation-catalog-service.js'

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i

function isValidObjectId(value: string): boolean {
  return OBJECT_ID_PATTERN.test(value)
}

export function normalizeLabel(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
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

export type ModerationCategoryErrorCode =
  | 'NORMALIZED_EMPTY'
  | 'DUPLICATE_CATEGORY'
  | 'DUPLICATE_CATALOG_CATEGORY'
  | 'INVALID_CATALOG_ID'
  | 'INVALID_TYPE'
  | 'INVALID_ENABLED'
  | 'INVALID_CATEGORY_ENTRY'
  | 'DUPLICATE_CATALOG_IN_REQUEST'
  | 'MISSING_CATALOG_ENTRY'
  | 'UNKNOWN_CATALOG_ID'
  | 'EMPTY_CATEGORIES'

type DuplicateModerationCategoryErrorCode = Exclude<
  ModerationCategoryErrorCode,
  | 'NORMALIZED_EMPTY'
  | 'INVALID_CATALOG_ID'
  | 'INVALID_TYPE'
  | 'INVALID_ENABLED'
  | 'INVALID_CATEGORY_ENTRY'
  | 'DUPLICATE_CATALOG_IN_REQUEST'
  | 'MISSING_CATALOG_ENTRY'
  | 'UNKNOWN_CATALOG_ID'
  | 'EMPTY_CATEGORIES'
>

export class ModerationCategoryServiceError extends Error {
  public readonly code: ModerationCategoryErrorCode

  constructor(message: string, code: ModerationCategoryErrorCode) {
    super(message)
    this.name = 'ModerationCategoryServiceError'
    this.code = code
  }
}

const VALID_TYPES: ModerationCategoryType[] = ['ban', 'timeout']

export function isValidType(value: string): value is ModerationCategoryType {
  return VALID_TYPES.includes(value as ModerationCategoryType)
}

export interface CreateCategoryInput {
  channelId: string
  catalogId: string
  type: ModerationCategoryType
  label: string
  definition: string
  enabled?: boolean
}

function getDuplicateErrorCode(error: unknown): DuplicateModerationCategoryErrorCode {
  if (!isRecord(error)) {
    return 'DUPLICATE_CATEGORY'
  }

  const keyPattern = isRecord(error.keyPattern) ? error.keyPattern : null
  const keyValue = isRecord(error.keyValue) ? error.keyValue : null

  if (keyPattern?.catalogId !== undefined || keyValue?.catalogId !== undefined) {
    return 'DUPLICATE_CATALOG_CATEGORY'
  }

  if (
    keyPattern?.normalizedLabel !== undefined ||
    keyPattern?.type !== undefined ||
    keyValue?.normalizedLabel !== undefined ||
    keyValue?.type !== undefined
  ) {
    return 'DUPLICATE_CATEGORY'
  }

  if (
    typeof error.message === 'string' &&
    error.message.includes('channelId_1_catalogId_1')
  ) {
    return 'DUPLICATE_CATALOG_CATEGORY'
  }

  return 'DUPLICATE_CATEGORY'
}

function getDuplicateErrorMessage(error: unknown): string {
  if (getDuplicateErrorCode(error) === 'DUPLICATE_CATALOG_CATEGORY') {
    return 'A category with this catalogId already exists in this channel'
  }

  return 'A category with this label and type already exists in this channel'
}

function throwDuplicateCategoryServiceError(error: unknown): never {
  throw new ModerationCategoryServiceError(
    getDuplicateErrorMessage(error),
    getDuplicateErrorCode(error)
  )
}

async function assertValidCatalogId(catalogId: string): Promise<void> {
  if (catalogId.length === 0 || !(await hasModerationCatalogEntry(catalogId))) {
    throw new ModerationCategoryServiceError(
      'catalogId must reference a seeded moderation catalog entry',
      'INVALID_CATALOG_ID'
    )
  }
}

export async function assertNoLegacyModerationCategoriesWithoutCatalogId(): Promise<void> {
  const legacyCount = await ModerationCategory.countDocuments({
    $or: [
      { catalogId: { $exists: false } },
      { catalogId: null },
      { catalogId: '' }
    ]
  }).exec()

  if (legacyCount > 0) {
    throw new Error(
      `Found ${legacyCount} moderation categories without catalogId. Clear or migrate legacy moderation categories before starting the server.`
    )
  }
}

export async function createCategory(
  input: CreateCategoryInput
): Promise<IModerationCategoryDocument> {
  const channelId = input.channelId.trim()
  const catalogId = normalizeCatalogId(input.catalogId)
  const normalizedLabel = normalizeLabel(input.label)

  if (normalizedLabel.length === 0) {
    throw new ModerationCategoryServiceError(
      'Label resolves to an empty value after normalization',
      'NORMALIZED_EMPTY'
    )
  }

  await assertValidCatalogId(catalogId)

  const [existing, existingCatalogCategory] = await Promise.all([
    ModerationCategory.findOne({
      channelId,
      type: input.type,
      normalizedLabel
    }).exec(),
    ModerationCategory.findOne({
      channelId,
      catalogId
    }).exec()
  ])

  if (existing) {
    throw new ModerationCategoryServiceError(
      'A category with this label and type already exists in this channel',
      'DUPLICATE_CATEGORY'
    )
  }

  if (existingCatalogCategory) {
    throw new ModerationCategoryServiceError(
      'A category with this catalogId already exists in this channel',
      'DUPLICATE_CATALOG_CATEGORY'
    )
  }

  try {
    return await ModerationCategory.create({
      channelId,
      catalogId,
      type: input.type,
      label: input.label.trim(),
      normalizedLabel,
      definition: input.definition.trim(),
      enabled: input.enabled ?? true
    })
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throwDuplicateCategoryServiceError(error)
    }
    throw error
  }
}

export interface ListCategoriesFilter {
  channelId?: string
  type?: ModerationCategoryType
}

export async function listCategories(
  filter?: ListCategoriesFilter
): Promise<IModerationCategoryDocument[]> {
  const query: Record<string, unknown> = {}

  const trimmedChannelId = filter?.channelId?.trim()
  if (trimmedChannelId) {
    query.channelId = trimmedChannelId
  }

  if (filter?.type) {
    query.type = filter.type
  }

  return ModerationCategory.find(query).sort({ createdAt: -1, _id: -1 }).exec()
}

export async function hasEnabledModerationCategories(channelId: string): Promise<boolean> {
  const trimmedChannelId = channelId.trim()

  if (trimmedChannelId.length === 0) {
    return false
  }

  const count = await ModerationCategory.countDocuments({
    channelId: trimmedChannelId,
    enabled: true
  }).exec()

  return count > 0
}

export async function getCategory(
  id: string
): Promise<IModerationCategoryDocument | null> {
  if (!isValidObjectId(id)) {
    return null
  }

  return ModerationCategory.findOne({ _id: id }).exec()
}

export interface UpdateCategoryInput {
  catalogId?: string
  label?: string
  definition?: string
  enabled?: boolean
  type?: ModerationCategoryType
}

export async function updateCategory(
  id: string,
  input: UpdateCategoryInput
): Promise<IModerationCategoryDocument | null> {
  if (!isValidObjectId(id)) {
    return null
  }

  const existing = await ModerationCategory.findOne({ _id: id }).exec()

  if (!existing) {
    return null
  }

  if (typeof existing.catalogId !== 'string' || existing.catalogId.trim().length === 0) {
    throw new Error(
      'Cannot update a legacy moderation category without catalogId. Clear or migrate legacy moderation categories before starting the server.'
    )
  }

  const updateData: Record<string, unknown> = {}
  const nextCatalogId =
    input.catalogId !== undefined
      ? normalizeCatalogId(input.catalogId)
      : existing.catalogId
  const nextType = input.type ?? existing.type
  const nextLabel = input.label !== undefined ? input.label.trim() : existing.label
  const nextNormalizedLabel =
    input.label !== undefined ? normalizeLabel(nextLabel) : existing.normalizedLabel

  if (input.catalogId !== undefined) {
    await assertValidCatalogId(nextCatalogId)
    updateData.catalogId = nextCatalogId
  }

  if (input.type !== undefined) {
    updateData.type = input.type
  }

  if (input.label !== undefined) {
    if (nextNormalizedLabel.length === 0) {
      throw new ModerationCategoryServiceError(
        'Label resolves to an empty value after normalization',
        'NORMALIZED_EMPTY'
      )
    }

    if (
      nextNormalizedLabel !== existing.normalizedLabel ||
      nextType !== existing.type
    ) {
      const duplicate = await ModerationCategory.findOne({
        channelId: existing.channelId,
        type: nextType,
        normalizedLabel: nextNormalizedLabel,
        _id: { $ne: existing._id }
      }).exec()

      if (duplicate) {
        throw new ModerationCategoryServiceError(
          'A category with this label and type already exists in this channel',
          'DUPLICATE_CATEGORY'
        )
      }
    }

    updateData.label = nextLabel
    updateData.normalizedLabel = nextNormalizedLabel
  } else if (input.type !== undefined) {
    // Type changed but label didn't — need to check new composite uniqueness
    const duplicate = await ModerationCategory.findOne({
      channelId: existing.channelId,
      type: input.type,
      normalizedLabel: existing.normalizedLabel,
      _id: { $ne: existing._id }
    }).exec()

    if (duplicate) {
      throw new ModerationCategoryServiceError(
        'A category with this label and type already exists in this channel',
        'DUPLICATE_CATEGORY'
      )
    }
  }

  if (nextCatalogId !== existing.catalogId) {
    const duplicate = await ModerationCategory.findOne({
      channelId: existing.channelId,
      catalogId: nextCatalogId,
      _id: { $ne: existing._id }
    }).exec()

    if (duplicate) {
      throw new ModerationCategoryServiceError(
        'A category with this catalogId already exists in this channel',
        'DUPLICATE_CATALOG_CATEGORY'
      )
    }
  }

  if (input.definition !== undefined) {
    updateData.definition = input.definition.trim()
  }

  if (input.enabled !== undefined) {
    updateData.enabled = input.enabled
  }

  try {
    return await ModerationCategory.findOneAndUpdate(
      { _id: id },
      { $set: updateData },
      { new: true }
    ).exec()
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throwDuplicateCategoryServiceError(error)
    }
    throw error
  }
}

export async function deleteCategory(id: string): Promise<boolean> {
  if (!isValidObjectId(id)) {
    return false
  }

  const result = await ModerationCategory.findOneAndDelete({ _id: id }).exec()

  return result !== null
}

// --------------- Bootstrap ---------------

export interface BootstrapCategoryInput {
  catalogId: string
  type: ModerationCategoryType
  enabled?: boolean
}

export interface BootstrapCategoriesInput {
  channelId: string
  categories: BootstrapCategoryInput[]
}

export interface BootstrapResult {
  channelId: string
  createdCount: number
  skippedCount: number
  categories: IModerationCategoryDocument[]
}

function buildCatalogDocMap(
  docs: IModerationCatalogDocument[]
): Map<string, IModerationCatalogDocument> {
  return new Map(docs.map((doc) => [normalizeCatalogId(doc.catalogId), doc]))
}

function normalizeBootstrapCategoryEntry(input: unknown): BootstrapCategoryInput {
  if (!isRecord(input)) {
    throw new ModerationCategoryServiceError(
      'Each bootstrap category must be an object',
      'INVALID_CATEGORY_ENTRY'
    )
  }

  const { catalogId, type, enabled } = input

  if (typeof catalogId !== 'string' || normalizeCatalogId(catalogId).length === 0) {
    throw new ModerationCategoryServiceError(
      'catalogId must reference a seeded moderation catalog entry',
      'INVALID_CATALOG_ID'
    )
  }

  if (typeof type !== 'string' || !isValidType(type)) {
    throw new ModerationCategoryServiceError(
      'type must be "ban" or "timeout"',
      'INVALID_TYPE'
    )
  }

  if (enabled !== undefined && typeof enabled !== 'boolean') {
    throw new ModerationCategoryServiceError(
      'enabled must be a boolean',
      'INVALID_ENABLED'
    )
  }

  return {
    catalogId: normalizeCatalogId(catalogId),
    type,
    enabled: enabled ?? true
  }
}

export async function bootstrapCategories(
  input: BootstrapCategoriesInput
): Promise<BootstrapResult> {
  const channelId = input.channelId.trim()
  const { categories } = input

  if (!Array.isArray(categories) || categories.length === 0) {
    throw new ModerationCategoryServiceError(
      'categories must be a non-empty array',
      'EMPTY_CATEGORIES'
    )
  }

  const normalizedSelections = categories.map((category) =>
    normalizeBootstrapCategoryEntry(category)
  )

  // Normalize and detect duplicates in the request
  const normalizedRequestIds = normalizedSelections.map((c) => c.catalogId)
  const uniqueRequestIds = new Set(normalizedRequestIds)
  if (uniqueRequestIds.size !== normalizedRequestIds.length) {
    throw new ModerationCategoryServiceError(
      'Duplicate catalogId in request categories',
      'DUPLICATE_CATALOG_IN_REQUEST'
    )
  }

  const catalogDocs = await ModerationCatalog.find({}).exec()
  const canonicalCatalogIds = new Set(
    catalogDocs.map((doc) => normalizeCatalogId(doc.catalogId))
  )
  const catalogMap = buildCatalogDocMap(catalogDocs)

  // Reject unknown catalog IDs
  for (const catalogId of uniqueRequestIds) {
    if (!canonicalCatalogIds.has(catalogId)) {
      throw new ModerationCategoryServiceError(
        `Unknown catalogId: ${catalogId}`,
        'UNKNOWN_CATALOG_ID'
      )
    }
  }

  // Reject missing canonical entries
  for (const canonicalId of canonicalCatalogIds) {
    if (!uniqueRequestIds.has(canonicalId)) {
      throw new ModerationCategoryServiceError(
        `Missing required catalog entry: ${canonicalId}`,
        'MISSING_CATALOG_ENTRY'
      )
    }
  }

  // Find existing categories for this channel
  const existingDocs = await ModerationCategory.find({
    channelId
  }).exec()

  const existingCatalogIds = new Set(
    existingDocs.map((doc) => normalizeCatalogId(doc.catalogId))
  )

  const pendingConflicts = new Set<string>()

  for (const selection of normalizedSelections) {
    if (existingCatalogIds.has(selection.catalogId)) {
      continue
    }

    const catalogEntry = catalogMap.get(selection.catalogId)

    if (!catalogEntry) {
      throw new ModerationCategoryServiceError(
        `Unknown catalogId: ${selection.catalogId}`,
        'UNKNOWN_CATALOG_ID'
      )
    }

    const normalizedCatalogLabel = normalizeLabel(catalogEntry.label)
    const conflictKey = `${selection.type}:${normalizedCatalogLabel}`

    if (pendingConflicts.has(conflictKey)) {
      throw new ModerationCategoryServiceError(
        `Bootstrap would create duplicate category label/type for catalogId ${selection.catalogId}`,
        'DUPLICATE_CATEGORY'
      )
    }

    const existingConflict = existingDocs.find(
      (doc) =>
        normalizeCatalogId(doc.catalogId) !== selection.catalogId &&
        doc.type === selection.type &&
        doc.normalizedLabel === normalizedCatalogLabel
    )

    if (existingConflict) {
      throw new ModerationCategoryServiceError(
        `Cannot bootstrap catalogId ${selection.catalogId} because another category in this channel already uses label "${catalogEntry.label}" with type "${selection.type}"`,
        'DUPLICATE_CATEGORY'
      )
    }

    pendingConflicts.add(conflictKey)
  }

  let createdCount = 0
  let skippedCount = 0

  for (const cat of normalizedSelections) {
    const normalizedId = cat.catalogId

    if (existingCatalogIds.has(normalizedId)) {
      skippedCount++
      continue
    }

    const catalogEntry = catalogMap.get(normalizedId)

    if (!catalogEntry) {
      throw new ModerationCategoryServiceError(
        `Unknown catalogId: ${normalizedId}`,
        'UNKNOWN_CATALOG_ID'
      )
    }

    try {
      await createCategory({
        channelId,
        catalogId: normalizedId,
        type: cat.type,
        label: catalogEntry.label,
        definition: catalogEntry.definition,
        enabled: cat.enabled
      })
      createdCount++
      existingCatalogIds.add(normalizedId)
    } catch (error) {
      if (
        error instanceof ModerationCategoryServiceError &&
        error.code === 'DUPLICATE_CATALOG_CATEGORY'
      ) {
        skippedCount++
        existingCatalogIds.add(normalizedId)
        continue
      }

      throw error
    }
  }

  // Return all channel categories using the existing list order
  const allCategories = await listCategories({ channelId })

  return {
    channelId,
    createdCount,
    skippedCount,
    categories: allCategories
  }
}
