import { ModerationCatalog } from '../../src/models/moderation-catalog.js'
import { ModerationCategory } from '../../src/models/moderation-category.js'
import {
  CANONICAL_MODERATION_CATALOG,
  seedModerationCatalog
} from '../../src/services/moderation-catalog-service.js'
import {
  assertNoLegacyModerationCategoriesWithoutCatalogId,
  bootstrapCategories,
  createCategory,
  normalizeLabel,
  ModerationCategoryServiceError,
  updateCategory,
  type BootstrapCategoriesInput
} from '../../src/services/moderation-category-service.js'
import {
  clearTestDatabase,
  registerTestModel
} from '../helpers/test-database.js'

type FindOneAndUpdateQuery = ReturnType<typeof ModerationCategory.findOneAndUpdate>
type CountDocumentsQuery = ReturnType<typeof ModerationCategory.countDocuments>

function rejectedFindOneAndUpdateQuery(error: unknown): FindOneAndUpdateQuery {
  return {
    exec: vi.fn().mockRejectedValueOnce(error)
  } as unknown as FindOneAndUpdateQuery
}

function resolvedCountDocumentsQuery(count: number): CountDocumentsQuery {
  return {
    exec: vi.fn().mockResolvedValueOnce(count)
  } as unknown as CountDocumentsQuery
}

function buildCategoryInput(
  overrides: Partial<{
    channelId: string
    catalogId: string
    type: 'ban' | 'timeout'
    label: string
    definition: string
    enabled: boolean
  }> = {}
) {
  return {
    channelId: 'ch-1',
    catalogId: 'SCAM',
    type: 'ban' as const,
    label: 'Hate Speech',
    definition: 'Content targeting protected groups',
    ...overrides
  }
}

describe('normalizeLabel', () => {
  it('trims whitespace, lowercases, and collapses whitespace', () => {
    expect(normalizeLabel('  Hate   Speech  ')).toBe('hate speech')
  })

  it('returns empty string for whitespace-only input', () => {
    expect(normalizeLabel('   ')).toBe('')
  })

  it('handles mixed case and punctuation', () => {
    expect(normalizeLabel('Spam & Bot Activity')).toBe('spam & bot activity')
  })
})

describe('createCategory', () => {
  beforeAll(() => {
    registerTestModel(ModerationCategory)
    registerTestModel(ModerationCatalog)
  })

  beforeEach(async () => {
    await clearTestDatabase()
    await seedModerationCatalog()
  })

  it('trims channelId and normalizes catalogId before storing', async () => {
    const category = await createCategory(
      buildCategoryInput({
        channelId: '  ch-trimmed  ',
        catalogId: '  scam  '
      })
    )

    expect(category.channelId).toBe('ch-trimmed')
    expect(category.catalogId).toBe('SCAM')
  })

  it('trims label and stores the original trimmed label', async () => {
    const category = await createCategory(
      buildCategoryInput({
        label: '  Hate Speech  '
      })
    )

    expect(category.label).toBe('Hate Speech')
    expect(category.normalizedLabel).toBe('hate speech')
  })

  it('defaults enabled to true', async () => {
    const category = await createCategory(buildCategoryInput())

    expect(category.enabled).toBe(true)
  })

  it('allows enabled to be set to false', async () => {
    const category = await createCategory(
      buildCategoryInput({
        catalogId: 'SELF_PROMO',
        type: 'timeout',
        label: 'Caps Lock',
        definition: 'Excessive uppercase',
        enabled: false
      })
    )

    expect(category.enabled).toBe(false)
  })

  it('rejects a label that normalizes to empty', async () => {
    await expect(
      createCategory(
        buildCategoryInput({
          label: '   '
        })
      )
    ).rejects.toThrow(ModerationCategoryServiceError)
  })

  it('rejects an unknown catalogId', async () => {
    await expect(
      createCategory(
        buildCategoryInput({
          catalogId: 'NOT_REAL'
        })
      )
    ).rejects.toMatchObject({
      name: 'ModerationCategoryServiceError',
      code: 'INVALID_CATALOG_ID'
    })
  })

  it('rejects a duplicate label+type in the same channel', async () => {
    await createCategory(buildCategoryInput())

    await expect(
      createCategory(
        buildCategoryInput({
          catalogId: 'THREAT',
          label: '  HATE SPEECH  '
        })
      )
    ).rejects.toMatchObject({
      name: 'ModerationCategoryServiceError',
      code: 'DUPLICATE_CATEGORY'
    })
  })

  it('rejects a duplicate catalogId in the same channel', async () => {
    await createCategory(buildCategoryInput())

    await expect(
      createCategory(
        buildCategoryInput({
          type: 'timeout',
          label: 'Different Label',
          definition: 'Different definition'
        })
      )
    ).rejects.toMatchObject({
      name: 'ModerationCategoryServiceError',
      code: 'DUPLICATE_CATALOG_CATEGORY'
    })
  })

  it('allows same label with different type in same channel when catalog differs', async () => {
    const ban = await createCategory(
      buildCategoryInput({
        catalogId: 'SCAM',
        type: 'ban',
        label: 'Spam'
      })
    )

    const timeout = await createCategory(
      buildCategoryInput({
        catalogId: 'SELF_PROMO',
        type: 'timeout',
        label: 'Spam'
      })
    )

    expect(ban.type).toBe('ban')
    expect(timeout.type).toBe('timeout')
    expect(ban.normalizedLabel).toBe(timeout.normalizedLabel)
  })

  it('allows same catalogId in different channels', async () => {
    const catA = await createCategory(buildCategoryInput({ channelId: 'ch-a' }))
    const catB = await createCategory(buildCategoryInput({ channelId: 'ch-b' }))

    expect(catA.channelId).toBe('ch-a')
    expect(catB.channelId).toBe('ch-b')
    expect(catA.catalogId).toBe('SCAM')
    expect(catB.catalogId).toBe('SCAM')
  })

  it('converts a DB duplicate-key error from create to DUPLICATE_CATEGORY', async () => {
    const duplicateError = Object.assign(
      new Error('E11000 duplicate key error collection'),
      { code: 11000 }
    )

    vi.spyOn(ModerationCategory, 'create').mockRejectedValueOnce(duplicateError)

    await expect(createCategory(buildCategoryInput())).rejects.toMatchObject({
      name: 'ModerationCategoryServiceError',
      code: 'DUPLICATE_CATEGORY',
      message: 'A category with this label and type already exists in this channel'
    })
  })

  it('converts a structured DB duplicate-key error from create to DUPLICATE_CATALOG_CATEGORY', async () => {
    const duplicateError = Object.assign(
      new Error('E11000 duplicate key error collection'),
      {
        code: 11000,
        keyPattern: { channelId: 1, catalogId: 1 },
        keyValue: { channelId: 'ch-1', catalogId: 'SCAM' }
      }
    )

    vi.spyOn(ModerationCategory, 'create').mockRejectedValueOnce(duplicateError)

    await expect(createCategory(buildCategoryInput())).rejects.toMatchObject({
      name: 'ModerationCategoryServiceError',
      code: 'DUPLICATE_CATALOG_CATEGORY',
      message: 'A category with this catalogId already exists in this channel'
    })
  })

  it('re-throws non-duplicate-key errors from create unchanged', async () => {
    const otherError = new Error('Some other DB error')
    vi.spyOn(ModerationCategory, 'create').mockRejectedValueOnce(otherError)

    await expect(createCategory(buildCategoryInput())).rejects.toThrow(
      'Some other DB error'
    )
  })
})

describe('updateCategory', () => {
  beforeAll(() => {
    registerTestModel(ModerationCategory)
    registerTestModel(ModerationCatalog)
  })

  beforeEach(async () => {
    await clearTestDatabase()
    await seedModerationCatalog()
  })

  it('rejects an updated label that normalizes to empty', async () => {
    const category = await createCategory(buildCategoryInput({ label: 'Spam' }))

    await expect(
      updateCategory(String(category._id), { label: '   ' })
    ).rejects.toThrow(ModerationCategoryServiceError)
  })

  it('rejects an update to a label+type that already exists in the same channel', async () => {
    await createCategory(
      buildCategoryInput({
        catalogId: 'SCAM',
        type: 'ban',
        label: 'Hate Speech',
        definition: 'First'
      })
    )

    const second = await createCategory(
      buildCategoryInput({
        catalogId: 'THREAT',
        type: 'ban',
        label: 'Spam',
        definition: 'Second'
      })
    )

    await expect(
      updateCategory(String(second._id), { label: '  HATE SPEECH  ' })
    ).rejects.toMatchObject({
      name: 'ModerationCategoryServiceError',
      code: 'DUPLICATE_CATEGORY'
    })
  })

  it('allows updating to its own unchanged normalized label', async () => {
    const category = await createCategory(buildCategoryInput({ label: 'Spam' }))

    const updated = await updateCategory(String(category._id), {
      label: '  spam  '
    })

    expect(updated).not.toBeNull()
    expect(updated!.normalizedLabel).toBe('spam')
  })

  it('allows changing type when the new combo is unique', async () => {
    const category = await createCategory(buildCategoryInput({ label: 'Spam' }))

    const updated = await updateCategory(String(category._id), {
      type: 'timeout'
    })

    expect(updated).not.toBeNull()
    expect(updated!.type).toBe('timeout')
  })

  it('rejects changing type when the new combo duplicates existing', async () => {
    await createCategory(
      buildCategoryInput({
        catalogId: 'SELF_PROMO',
        type: 'timeout',
        label: 'Spam',
        definition: 'Timeout spam'
      })
    )

    const banCategory = await createCategory(
      buildCategoryInput({
        catalogId: 'SCAM',
        type: 'ban',
        label: 'Spam',
        definition: 'Ban spam'
      })
    )

    await expect(
      updateCategory(String(banCategory._id), { type: 'timeout' })
    ).rejects.toMatchObject({
      name: 'ModerationCategoryServiceError',
      code: 'DUPLICATE_CATEGORY'
    })
  })

  it('allows changing catalogId to another seeded catalog entry', async () => {
    const category = await createCategory(buildCategoryInput({ catalogId: 'SCAM' }))

    const updated = await updateCategory(String(category._id), {
      catalogId: 'threat'
    })

    expect(updated).not.toBeNull()
    expect(updated!.catalogId).toBe('THREAT')
  })

  it('rejects changing catalogId to an unknown entry', async () => {
    const category = await createCategory(buildCategoryInput())

    await expect(
      updateCategory(String(category._id), { catalogId: 'not_real' })
    ).rejects.toMatchObject({
      name: 'ModerationCategoryServiceError',
      code: 'INVALID_CATALOG_ID'
    })
  })

  it('rejects changing catalogId when the new catalog already exists in the channel', async () => {
    await createCategory(buildCategoryInput({ catalogId: 'SCAM', label: 'Spam' }))

    const second = await createCategory(
      buildCategoryInput({
        catalogId: 'THREAT',
        label: 'Threats',
        definition: 'Threat content'
      })
    )

    await expect(
      updateCategory(String(second._id), { catalogId: 'SCAM' })
    ).rejects.toMatchObject({
      name: 'ModerationCategoryServiceError',
      code: 'DUPLICATE_CATALOG_CATEGORY'
    })
  })

  it('converts a DB duplicate-key error from findOneAndUpdate to DUPLICATE_CATEGORY', async () => {
    const category = await createCategory(
      buildCategoryInput({
        label: 'Old label',
        definition: 'Old def'
      })
    )

    const duplicateError = Object.assign(
      new Error('E11000 duplicate key error collection'),
      { code: 11000 }
    )

    vi.spyOn(ModerationCategory, 'findOneAndUpdate').mockReturnValue(
      rejectedFindOneAndUpdateQuery(duplicateError)
    )

    await expect(
      updateCategory(String(category._id), { label: 'New label' })
    ).rejects.toMatchObject({
      name: 'ModerationCategoryServiceError',
      code: 'DUPLICATE_CATEGORY',
      message: 'A category with this label and type already exists in this channel'
    })
  })

  it('converts a structured DB duplicate-key error from findOneAndUpdate to DUPLICATE_CATALOG_CATEGORY', async () => {
    const category = await createCategory(
      buildCategoryInput({
        label: 'Old label',
        definition: 'Old def'
      })
    )

    const duplicateError = Object.assign(
      new Error('E11000 duplicate key error collection'),
      {
        code: 11000,
        keyPattern: { channelId: 1, catalogId: 1 },
        keyValue: { channelId: 'ch-1', catalogId: 'THREAT' }
      }
    )

    vi.spyOn(ModerationCategory, 'findOneAndUpdate').mockReturnValue(
      rejectedFindOneAndUpdateQuery(duplicateError)
    )

    await expect(
      updateCategory(String(category._id), { catalogId: 'THREAT' })
    ).rejects.toMatchObject({
      name: 'ModerationCategoryServiceError',
      code: 'DUPLICATE_CATALOG_CATEGORY',
      message: 'A category with this catalogId already exists in this channel'
    })
  })

  it('re-throws non-duplicate-key errors from findOneAndUpdate unchanged', async () => {
    const category = await createCategory(
      buildCategoryInput({
        label: 'Old label',
        definition: 'Old def'
      })
    )

    const otherError = new Error('Some other DB error')

    vi.spyOn(ModerationCategory, 'findOneAndUpdate').mockReturnValue(
      rejectedFindOneAndUpdateQuery(otherError)
    )

    await expect(
      updateCategory(String(category._id), { label: 'New label' })
    ).rejects.toThrow('Some other DB error')
  })
})

describe('assertNoLegacyModerationCategoriesWithoutCatalogId', () => {
  it('throws when legacy moderation categories without catalogId exist', async () => {
    vi.spyOn(ModerationCategory, 'countDocuments').mockReturnValue(
      resolvedCountDocumentsQuery(2)
    )

    await expect(
      assertNoLegacyModerationCategoriesWithoutCatalogId()
    ).rejects.toThrow(/without catalogId/)
  })

  it('passes when no legacy moderation categories are found', async () => {
    vi.spyOn(ModerationCategory, 'countDocuments').mockReturnValue(
      resolvedCountDocumentsQuery(0)
    )

    await expect(
      assertNoLegacyModerationCategoriesWithoutCatalogId()
    ).resolves.toBeUndefined()
  })
})

describe('bootstrapCategories', () => {
  beforeAll(() => {
    registerTestModel(ModerationCategory)
    registerTestModel(ModerationCatalog)
  })

  beforeEach(async () => {
    await clearTestDatabase()
    await seedModerationCatalog()
  })

  function buildBootstrapInput(
    overrides: Partial<BootstrapCategoriesInput> = {}
  ): BootstrapCategoriesInput {
    return {
      channelId: 'ch-bootstrap',
      categories: CANONICAL_MODERATION_CATALOG.map((entry) => ({
        catalogId: entry.catalogId,
        type: 'ban' as const,
        enabled: true
      })),
      ...overrides
    }
  }

  it('creates all 13 categories from the catalog on first bootstrap', async () => {
    const result = await bootstrapCategories(buildBootstrapInput())

    expect(result.channelId).toBe('ch-bootstrap')
    expect(result.createdCount).toBe(13)
    expect(result.skippedCount).toBe(0)
    expect(result.categories).toHaveLength(13)

    const catalogIds = result.categories.map((c) => c.catalogId)
    for (const entry of CANONICAL_MODERATION_CATALOG) {
      expect(catalogIds).toContain(entry.catalogId)
    }
  })

  it('uses labels and definitions from ModerationCatalog, not from the request', async () => {
    await ModerationCatalog.findOneAndUpdate(
      { catalogId: 'SCAM' },
      {
        $set: {
          label: 'Updated Scam Label',
          definition: 'Updated scam definition from catalog'
        }
      }
    ).exec()

    const result = await bootstrapCategories(buildBootstrapInput())

    const scam = result.categories.find((c) => c.catalogId === 'SCAM')

    expect(scam?.label).toBe('Updated Scam Label')
    expect(scam?.definition).toBe('Updated scam definition from catalog')
  })

  it('is idempotent — repeated bootstrap skips all categories', async () => {
    await bootstrapCategories(buildBootstrapInput())

    const result = await bootstrapCategories(buildBootstrapInput())

    expect(result.createdCount).toBe(0)
    expect(result.skippedCount).toBe(13)
    expect(result.categories).toHaveLength(13)
  })

  it('creates only missing categories when some already exist', async () => {
    const channelId = 'ch-partial'

    await ModerationCategory.create({
      channelId,
      catalogId: 'SCAM',
      type: 'ban',
      label: 'Scam or phishing',
      normalizedLabel: 'scam or phishing',
      definition: 'Scam content',
      enabled: true
    })
    await ModerationCategory.create({
      channelId,
      catalogId: 'THREAT',
      type: 'timeout',
      label: 'Threat',
      normalizedLabel: 'threat',
      definition: 'Threat content',
      enabled: false
    })

    const result = await bootstrapCategories(buildBootstrapInput({ channelId }))

    expect(result.createdCount).toBe(11)
    expect(result.skippedCount).toBe(2)
    expect(result.categories).toHaveLength(13)
  })

  it('skips existing catalog IDs even when stored docs use lowercase catalogId', async () => {
    const channelId = 'ch-lowercase-existing'

    await ModerationCategory.create({
      channelId,
      catalogId: 'scam',
      type: 'ban',
      label: 'Scam or phishing',
      normalizedLabel: 'scam or phishing',
      definition: 'Existing lowercase catalog entry',
      enabled: true
    })

    const result = await bootstrapCategories(buildBootstrapInput({ channelId }))

    expect(result.createdCount).toBe(12)
    expect(result.skippedCount).toBe(1)
    expect(result.categories).toHaveLength(13)
    await expect(
      ModerationCategory.countDocuments({
        channelId,
        catalogId: { $in: ['scam', 'SCAM'] }
      })
    ).resolves.toBe(1)
  })

  it('returns all categories including previously existing ones, not only newly created', async () => {
    const channelId = 'ch-all'

    await ModerationCategory.create({
      channelId,
      catalogId: 'SCAM',
      type: 'ban',
      label: 'Scam or phishing',
      normalizedLabel: 'scam or phishing',
      definition: 'Scam content',
      enabled: true
    })

    const result = await bootstrapCategories(buildBootstrapInput({ channelId }))

    expect(result.categories).toHaveLength(13)
    expect(result.createdCount).toBe(12)
    expect(result.skippedCount).toBe(1)

    const scamCategory = result.categories.find((c) => c.catalogId === 'SCAM')
    expect(scamCategory).toBeDefined()
    expect(scamCategory!.definition).toBe('Scam content')
  })

  it('does not overwrite existing categories when skipping', async () => {
    const channelId = 'ch-no-overwrite'

    await ModerationCategory.create({
      channelId,
      catalogId: 'SCAM',
      type: 'timeout',
      label: 'Custom Scam',
      normalizedLabel: 'custom scam',
      definition: 'My custom scam definition',
      enabled: false
    })

    const result = await bootstrapCategories(buildBootstrapInput({ channelId }))

    expect(result.skippedCount).toBe(1)
    expect(result.createdCount).toBe(12)

    const scam = result.categories.find((c) => c.catalogId === 'SCAM')!
    expect(scam.type).toBe('timeout')
    expect(scam.label).toBe('Custom Scam')
    expect(scam.definition).toBe('My custom scam definition')
    expect(scam.enabled).toBe(false)
  })

  it('respects individual enabled flags from the request', async () => {
    const input = buildBootstrapInput()
    input.categories = input.categories.map((cat) =>
      cat.catalogId === 'SCAM' || cat.catalogId === 'SPAM'
        ? { ...cat, enabled: false }
        : cat
    )

    const result = await bootstrapCategories(input)

    const scam = result.categories.find((c) => c.catalogId === 'SCAM')!
    const spam = result.categories.find((c) => c.catalogId === 'SPAM')!
    const threat = result.categories.find((c) => c.catalogId === 'THREAT')!

    expect(scam.enabled).toBe(false)
    expect(spam.enabled).toBe(false)
    expect(threat.enabled).toBe(true)
  })

  it('respects individual type flags from the request', async () => {
    const input = buildBootstrapInput()
    input.categories = input.categories.map((cat) =>
      cat.catalogId === 'SCAM' || cat.catalogId === 'SELF_PROMO'
        ? { ...cat, type: 'timeout' as const }
        : cat
    )

    const result = await bootstrapCategories(input)

    const scam = result.categories.find((c) => c.catalogId === 'SCAM')!
    const selfPromo = result.categories.find((c) => c.catalogId === 'SELF_PROMO')!
    const threat = result.categories.find((c) => c.catalogId === 'THREAT')!

    expect(scam.type).toBe('timeout')
    expect(selfPromo.type).toBe('timeout')
    expect(threat.type).toBe('ban')
  })

  it('allows bootstrapping independently per channel', async () => {
    const resultA = await bootstrapCategories(
      buildBootstrapInput({ channelId: 'ch-a' })
    )
    const resultB = await bootstrapCategories(
      buildBootstrapInput({ channelId: 'ch-b' })
    )

    expect(resultA.createdCount).toBe(13)
    expect(resultB.createdCount).toBe(13)

    for (const cat of resultA.categories) {
      expect(cat.channelId).toBe('ch-a')
    }
    for (const cat of resultB.categories) {
      expect(cat.channelId).toBe('ch-b')
    }
  })

  it('rejects before writing when an existing category conflicts on label and type', async () => {
    const channelId = 'ch-conflict'

    await ModerationCategory.create({
      channelId,
      catalogId: 'THREAT',
      type: 'ban',
      label: 'Scam or phishing',
      normalizedLabel: 'scam or phishing',
      definition: 'Conflicting existing category',
      enabled: true
    })

    await expect(
      bootstrapCategories(buildBootstrapInput({ channelId }))
    ).rejects.toMatchObject({
      name: 'ModerationCategoryServiceError',
      code: 'DUPLICATE_CATEGORY'
    })

    await expect(ModerationCategory.countDocuments({ channelId })).resolves.toBe(1)
  })

  it('trims channelId before storing', async () => {
    const result = await bootstrapCategories({
      ...buildBootstrapInput(),
      channelId: '  ch-trimmed  '
    })

    expect(result.channelId).toBe('ch-trimmed')
    expect(result.categories).toHaveLength(13)
    for (const cat of result.categories) {
      expect(cat.channelId).toBe('ch-trimmed')
    }
  })

  // --- Validation / rejection tests ---

  it('rejects when categories is not an array', async () => {
    await expect(
      bootstrapCategories({
        channelId: 'ch-1',
        categories: 'not-an-array' as unknown as BootstrapCategoriesInput['categories']
      })
    ).rejects.toMatchObject({
      name: 'ModerationCategoryServiceError',
      code: 'EMPTY_CATEGORIES'
    })
  })

  it('rejects an empty categories array', async () => {
    await expect(
      bootstrapCategories({ channelId: 'ch-1', categories: [] })
    ).rejects.toMatchObject({
      name: 'ModerationCategoryServiceError',
      code: 'EMPTY_CATEGORIES'
    })
  })

  it('rejects duplicate catalogId in the request', async () => {
    const input = buildBootstrapInput()
    input.categories[1] = { catalogId: 'SCAM', type: 'ban', enabled: true }

    await expect(bootstrapCategories(input)).rejects.toMatchObject({
      name: 'ModerationCategoryServiceError',
      code: 'DUPLICATE_CATALOG_IN_REQUEST'
    })
  })

  it('rejects duplicate catalogId regardless of casing', async () => {
    const input = buildBootstrapInput()
    input.categories[1] = { catalogId: 'scam', type: 'ban', enabled: true }

    await expect(bootstrapCategories(input)).rejects.toMatchObject({
      name: 'ModerationCategoryServiceError',
      code: 'DUPLICATE_CATALOG_IN_REQUEST'
    })
  })

  it('rejects an unknown catalogId', async () => {
    const input = buildBootstrapInput()
    input.categories[0] = { catalogId: 'NOT_REAL', type: 'ban', enabled: true }

    await expect(bootstrapCategories(input)).rejects.toMatchObject({
      name: 'ModerationCategoryServiceError',
      code: 'UNKNOWN_CATALOG_ID'
    })
  })

  it('rejects an invalid type at the service boundary', async () => {
    const input = buildBootstrapInput()
    input.categories[0] = {
      catalogId: 'SCAM',
      type: 'invalid' as unknown as 'ban',
      enabled: true
    }

    await expect(bootstrapCategories(input)).rejects.toMatchObject({
      name: 'ModerationCategoryServiceError',
      code: 'INVALID_TYPE'
    })
  })

  it('rejects a non-boolean enabled value at the service boundary', async () => {
    const input = buildBootstrapInput()
    input.categories[0] = {
      catalogId: 'SCAM',
      type: 'ban',
      enabled: 'yes' as unknown as boolean
    }

    await expect(bootstrapCategories(input)).rejects.toMatchObject({
      name: 'ModerationCategoryServiceError',
      code: 'INVALID_ENABLED'
    })
  })

  it('rejects a non-object category entry at the service boundary', async () => {
    await expect(
      bootstrapCategories({
        channelId: 'ch-1',
        categories: [null] as unknown as BootstrapCategoriesInput['categories']
      })
    ).rejects.toMatchObject({
      name: 'ModerationCategoryServiceError',
      code: 'INVALID_CATEGORY_ENTRY'
    })
  })

  it('rejects when a required canonical catalog entry is missing', async () => {
    const categories = buildBootstrapInput().categories.slice(0, -1)

    await expect(
      bootstrapCategories({ channelId: 'ch-1', categories })
    ).rejects.toMatchObject({
      name: 'ModerationCategoryServiceError',
      code: 'MISSING_CATALOG_ENTRY'
    })
  })
})
