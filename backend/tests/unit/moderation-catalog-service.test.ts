import { ModerationCatalog } from '../../src/models/moderation-catalog.js'
import {
  CANONICAL_MODERATION_CATALOG,
  hasModerationCatalogEntry,
  listModerationCatalogEntries,
  seedModerationCatalog
} from '../../src/services/moderation-catalog-service.js'
import {
  clearTestDatabase,
  registerTestModel
} from '../helpers/test-database.js'

describe('seedModerationCatalog', () => {
  beforeAll(() => {
    registerTestModel(ModerationCatalog)
  })

  beforeEach(async () => {
    await clearTestDatabase()
  })

  it('seeds all canonical moderation catalog entries', async () => {
    await seedModerationCatalog()

    const entries = await ModerationCatalog.find({}).sort({ catalogId: 1 }).exec()

    expect(entries).toHaveLength(CANONICAL_MODERATION_CATALOG.length)
    expect(entries.map((entry) => entry.catalogId).sort()).toEqual(
      CANONICAL_MODERATION_CATALOG.map((entry) => entry.catalogId).sort()
    )
  })

  it('is idempotent and restores canonical labels and definitions', async () => {
    await seedModerationCatalog()

    await ModerationCatalog.findOneAndUpdate(
      { catalogId: 'SCAM' },
      {
        $set: {
          label: 'Changed label',
          definition: 'Changed definition'
        }
      }
    ).exec()

    await seedModerationCatalog()

    const restored = await ModerationCatalog.findOne({ catalogId: 'SCAM' }).exec()
    const canonical = CANONICAL_MODERATION_CATALOG.find(
      (entry) => entry.catalogId === 'SCAM'
    )

    expect(restored?.label).toBe(canonical?.label)
    expect(restored?.definition).toBe(canonical?.definition)
    await expect(ModerationCatalog.countDocuments({})).resolves.toBe(
      CANONICAL_MODERATION_CATALOG.length
    )
  })
})

describe('hasModerationCatalogEntry', () => {
  beforeAll(() => {
    registerTestModel(ModerationCatalog)
  })

  beforeEach(async () => {
    await clearTestDatabase()
    await seedModerationCatalog()
  })

  it('matches seeded catalog IDs case-insensitively after normalization', async () => {
    await expect(hasModerationCatalogEntry(' scam ')).resolves.toBe(true)
  })

  it('returns false for unknown catalog IDs', async () => {
    await expect(hasModerationCatalogEntry('NOT_REAL')).resolves.toBe(false)
  })
})

describe('listModerationCatalogEntries', () => {
  it('returns canonical entries in canonical order', () => {
    expect(listModerationCatalogEntries()).toEqual(CANONICAL_MODERATION_CATALOG)
  })

  it('returns copies so callers cannot mutate the canonical catalog', () => {
    const entries = listModerationCatalogEntries()
    entries[0]!.label = 'Mutated label'

    expect(listModerationCatalogEntries()[0]?.label).toBe(
      CANONICAL_MODERATION_CATALOG[0]?.label
    )
  })
})
