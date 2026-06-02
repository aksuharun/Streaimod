import request from 'supertest'

import { ModerationCatalog } from '../../src/models/moderation-catalog.js'
import { ModerationCategory } from '../../src/models/moderation-category.js'
import {
  CANONICAL_MODERATION_CATALOG,
  seedModerationCatalog
} from '../../src/services/moderation-catalog-service.js'
import { uniqueTestId } from '../helpers/factories.js'
import { createTestApp } from '../helpers/test-app.js'
import {
  clearTestDatabase,
  registerTestModel
} from '../helpers/test-database.js'

function buildCategoryPayload(
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
    channelId: uniqueTestId('ch'),
    catalogId: 'SCAM',
    type: 'ban' as const,
    label: 'Spam',
    definition: 'Unwanted messages',
    ...overrides
  }
}

async function createCategoryViaApi(
  app: ReturnType<typeof createTestApp>,
  overrides: Parameters<typeof buildCategoryPayload>[0] = {}
) {
  const payload = buildCategoryPayload(overrides)
  const response = await request(app)
    .post('/api/moderation-categories')
    .send(payload)
    .expect(201)

  return { payload, response }
}

describe('Moderation Categories API', () => {
  beforeAll(() => {
    registerTestModel(ModerationCategory)
    registerTestModel(ModerationCatalog)
  })

  beforeEach(async () => {
    await clearTestDatabase()
    await seedModerationCatalog()
  })

  describe('POST /api/moderation-categories', () => {
    it('creates a category and returns 201 with DTO', async () => {
      const app = createTestApp()
      const payload = buildCategoryPayload({
        label: 'Hate Speech',
        definition: 'Content targeting protected groups'
      })

      const response = await request(app)
        .post('/api/moderation-categories')
        .send(payload)
        .expect(201)

      expect(response.body).toMatchObject({
        channelId: payload.channelId,
        catalogId: payload.catalogId,
        type: 'ban',
        label: 'Hate Speech',
        definition: payload.definition,
        enabled: true
      })
      expect(response.body.id).toBeDefined()
      expect(response.body.createdAt).toBeDefined()
      expect(response.body.updatedAt).toBeDefined()
      expect(response.body).not.toHaveProperty('_id')
      expect(response.body).not.toHaveProperty('__v')
      expect(response.body).not.toHaveProperty('normalizedLabel')
    })

    it('returns 400 when catalogId is missing', async () => {
      const app = createTestApp()

      const response = await request(app)
        .post('/api/moderation-categories')
        .send({
          channelId: uniqueTestId('ch'),
          type: 'ban',
          label: 'Spam',
          definition: 'Unwanted'
        })
        .expect(400)

      expect(response.body.error).toMatch(/catalogId/)
    })

    it('returns 400 when catalogId is not seeded', async () => {
      const app = createTestApp()

      const response = await request(app)
        .post('/api/moderation-categories')
        .send(buildCategoryPayload({ catalogId: 'NOT_REAL' }))
        .expect(400)

      expect(response.body.error).toMatch(/catalogId/)
    })

    it('returns 400 when enabled is not a boolean', async () => {
      const app = createTestApp()

      const response = await request(app)
        .post('/api/moderation-categories')
        .send(buildCategoryPayload({ enabled: 'yes' as unknown as boolean }))
        .expect(400)

      expect(response.body.error).toMatch(/enabled/)
    })

    it('trims channelId and normalizes catalogId before storing', async () => {
      const app = createTestApp()

      const response = await request(app)
        .post('/api/moderation-categories')
        .send(
          buildCategoryPayload({
            channelId: '  ch-trimmed  ',
            catalogId: '  scam  '
          })
        )
        .expect(201)

      expect(response.body.channelId).toBe('ch-trimmed')
      expect(response.body.catalogId).toBe('SCAM')
    })

    it('returns 409 when creating a duplicate label+type in same channel', async () => {
      const app = createTestApp()
      const channelId = uniqueTestId('ch')

      await createCategoryViaApi(app, {
        channelId,
        catalogId: 'SCAM',
        type: 'ban',
        label: 'Hate Speech',
        definition: 'First'
      })

      const response = await request(app)
        .post('/api/moderation-categories')
        .send(
          buildCategoryPayload({
            channelId,
            catalogId: 'THREAT',
            type: 'ban',
            label: 'Hate Speech',
            definition: 'Second'
          })
        )
        .expect(409)

      expect(response.body.error).toMatch(/already exists/)
    })

    it('returns 409 when creating a duplicate catalogId in same channel', async () => {
      const app = createTestApp()
      const channelId = uniqueTestId('ch')

      await createCategoryViaApi(app, {
        channelId,
        catalogId: 'SCAM',
        type: 'ban',
        label: 'Spam',
        definition: 'First'
      })

      const response = await request(app)
        .post('/api/moderation-categories')
        .send(
          buildCategoryPayload({
            channelId,
            catalogId: 'SCAM',
            type: 'timeout',
            label: 'Another label',
            definition: 'Second'
          })
        )
        .expect(409)

      expect(response.body.error).toMatch(/catalogId/)
    })

    it('allows same label with different type in same channel when catalog differs', async () => {
      const app = createTestApp()
      const channelId = uniqueTestId('ch')

      await createCategoryViaApi(app, {
        channelId,
        catalogId: 'SCAM',
        type: 'ban',
        label: 'Spam',
        definition: 'Ban spam'
      })

      const response = await request(app)
        .post('/api/moderation-categories')
        .send(
          buildCategoryPayload({
            channelId,
            catalogId: 'SELF_PROMO',
            type: 'timeout',
            label: 'Spam',
            definition: 'Timeout spam'
          })
        )
        .expect(201)

      expect(response.body.id).toBeDefined()
      expect(response.body.type).toBe('timeout')
    })
  })

  describe('GET /api/moderation-categories', () => {
    it('lists all categories ordered by newest first without _id or __v', async () => {
      const app = createTestApp()
      const channelId = uniqueTestId('ch')

      await createCategoryViaApi(app, {
        channelId,
        catalogId: 'SCAM',
        type: 'ban',
        label: 'First',
        definition: 'D1'
      })

      await new Promise((resolve) => setTimeout(resolve, 10))

      await createCategoryViaApi(app, {
        channelId,
        catalogId: 'THREAT',
        type: 'ban',
        label: 'Second',
        definition: 'D2'
      })

      const response = await request(app)
        .get('/api/moderation-categories')
        .expect(200)

      expect(response.body).toHaveLength(2)
      expect(response.body[0].label).toBe('Second')
      expect(response.body[1].label).toBe('First')
      for (const category of response.body) {
        expect(category).toHaveProperty('id')
        expect(category).toHaveProperty('catalogId')
        expect(category).not.toHaveProperty('_id')
        expect(category).not.toHaveProperty('__v')
      }
    })

    it('filters by channelId and type together', async () => {
      const app = createTestApp()
      const channelA = uniqueTestId('ch-a')
      const channelB = uniqueTestId('ch-b')

      await createCategoryViaApi(app, {
        channelId: channelA,
        catalogId: 'SCAM',
        type: 'ban',
        label: 'Spam',
        definition: 'D'
      })

      await createCategoryViaApi(app, {
        channelId: channelA,
        catalogId: 'SELF_PROMO',
        type: 'timeout',
        label: 'Caps',
        definition: 'D'
      })

      await createCategoryViaApi(app, {
        channelId: channelB,
        catalogId: 'THREAT',
        type: 'ban',
        label: 'Hate',
        definition: 'D'
      })

      const response = await request(app)
        .get(`/api/moderation-categories?channelId=${encodeURIComponent(channelA)}&type=ban`)
        .expect(200)

      expect(response.body).toHaveLength(1)
      expect(response.body[0].channelId).toBe(channelA)
      expect(response.body[0].type).toBe('ban')
    })

    it('returns 400 when channelId filter is repeated', async () => {
      const app = createTestApp()

      const response = await request(app)
        .get('/api/moderation-categories?channelId=a&channelId=b')
        .expect(400)

      expect(response.body.error).toMatch(/channelId/)
    })

    it('returns 400 when type filter uses array syntax', async () => {
      const app = createTestApp()

      const response = await request(app)
        .get('/api/moderation-categories?type[]=ban')
        .expect(400)

      expect(response.body.error).toMatch(/type/)
    })

    it('returns an empty array when no categories exist', async () => {
      const app = createTestApp()
      await clearTestDatabase()
      await seedModerationCatalog()

      const response = await request(app)
        .get('/api/moderation-categories')
        .expect(200)

      expect(response.body).toEqual([])
    })
  })

  describe('GET /api/moderation-categories/:id', () => {
    it('returns a single category by ID with catalogId in the DTO', async () => {
      const app = createTestApp()
      const { payload, response: created } = await createCategoryViaApi(app, {
        catalogId: 'SCAM',
        label: 'Hate Speech',
        definition: 'Content targeting protected groups'
      })

      const response = await request(app)
        .get(`/api/moderation-categories/${created.body.id}`)
        .expect(200)

      expect(response.body.id).toBe(created.body.id)
      expect(response.body.label).toBe(payload.label)
      expect(response.body.catalogId).toBe(payload.catalogId)
      expect(response.body).not.toHaveProperty('_id')
      expect(response.body).not.toHaveProperty('__v')
    })

    it('returns 404 for an invalid ObjectId format', async () => {
      const app = createTestApp()

      const response = await request(app)
        .get('/api/moderation-categories/not-a-valid-id')
        .expect(404)

      expect(response.body).toEqual({ error: 'Moderation category not found' })
    })
  })

  describe('PATCH /api/moderation-categories/:id', () => {
    it('updates label and recomputes normalizedLabel without exposing it', async () => {
      const app = createTestApp()
      const { response: created } = await createCategoryViaApi(app, {
        label: 'Old Label',
        definition: 'Some definition'
      })

      const response = await request(app)
        .patch(`/api/moderation-categories/${created.body.id}`)
        .send({ label: '  New Label  ' })
        .expect(200)

      expect(response.body.label).toBe('New Label')
      expect(response.body.definition).toBe('Some definition')
      expect(response.body.normalizedLabel).toBeUndefined()
    })

    it('updates definition, enabled flag, and type', async () => {
      const app = createTestApp()
      const { response: created } = await createCategoryViaApi(app)

      const response = await request(app)
        .patch(`/api/moderation-categories/${created.body.id}`)
        .send({ definition: 'New definition', enabled: false, type: 'timeout' })
        .expect(200)

      expect(response.body.definition).toBe('New definition')
      expect(response.body.enabled).toBe(false)
      expect(response.body.type).toBe('timeout')
    })

    it('updates catalogId', async () => {
      const app = createTestApp()
      const { response: created } = await createCategoryViaApi(app, {
        catalogId: 'SCAM',
        label: 'Spam'
      })

      const response = await request(app)
        .patch(`/api/moderation-categories/${created.body.id}`)
        .send({ catalogId: 'threat' })
        .expect(200)

      expect(response.body.catalogId).toBe('THREAT')
    })

    it('returns 400 when catalogId is not seeded', async () => {
      const app = createTestApp()
      const { response: created } = await createCategoryViaApi(app)

      const response = await request(app)
        .patch(`/api/moderation-categories/${created.body.id}`)
        .send({ catalogId: 'NOT_REAL' })
        .expect(400)

      expect(response.body.error).toMatch(/catalogId/)
    })

    it('returns 409 when updating to a duplicate label+type in same channel', async () => {
      const app = createTestApp()
      const channelId = uniqueTestId('ch')

      await createCategoryViaApi(app, {
        channelId,
        catalogId: 'SCAM',
        type: 'ban',
        label: 'Hate Speech',
        definition: 'First'
      })

      const { response: second } = await createCategoryViaApi(app, {
        channelId,
        catalogId: 'THREAT',
        type: 'ban',
        label: 'Spam',
        definition: 'Second'
      })

      const response = await request(app)
        .patch(`/api/moderation-categories/${second.body.id}`)
        .send({ label: 'Hate Speech' })
        .expect(409)

      expect(response.body.error).toMatch(/already exists/)
    })

    it('returns 409 when updating to a duplicate catalogId in same channel', async () => {
      const app = createTestApp()
      const channelId = uniqueTestId('ch')

      await createCategoryViaApi(app, {
        channelId,
        catalogId: 'SCAM',
        label: 'Spam',
        definition: 'First'
      })

      const { response: second } = await createCategoryViaApi(app, {
        channelId,
        catalogId: 'THREAT',
        label: 'Threats',
        definition: 'Second'
      })

      const response = await request(app)
        .patch(`/api/moderation-categories/${second.body.id}`)
        .send({ catalogId: 'SCAM' })
        .expect(409)

      expect(response.body.error).toMatch(/catalogId/)
    })

    it('returns 400 when no valid fields are provided', async () => {
      const app = createTestApp()
      const { response: created } = await createCategoryViaApi(app)

      const response = await request(app)
        .patch(`/api/moderation-categories/${created.body.id}`)
        .send({})
        .expect(400)

      expect(response.body.error).toMatch(/At least one/)
    })
  })

  describe('DELETE /api/moderation-categories/:id', () => {
    it('deletes a category and returns 204', async () => {
      const app = createTestApp()
      const { response: created } = await createCategoryViaApi(app)

      await request(app)
        .delete(`/api/moderation-categories/${created.body.id}`)
        .expect(204)

      await request(app)
        .get(`/api/moderation-categories/${created.body.id}`)
        .expect(404)
    })

    it('returns 404 for a non-existent ID', async () => {
      const app = createTestApp()

      const response = await request(app)
        .delete('/api/moderation-categories/507f1f77bcf86cd799439011')
        .expect(404)

      expect(response.body).toEqual({ error: 'Moderation category not found' })
    })
  })

  describe('POST /api/moderation-categories/bootstrap', () => {
    function buildBootstrapPayload(
      overrides: Partial<{
        channelId: string
        categories: Array<{ catalogId: string; type: string; enabled: boolean }>
      }> = {}
    ) {
      return {
        channelId: uniqueTestId('ch'),
        categories: CANONICAL_MODERATION_CATALOG.map((entry) => ({
          catalogId: entry.catalogId,
          type: 'ban' as const,
          enabled: true
        })),
        ...overrides
      }
    }

    it('creates all 13 categories and returns 201', async () => {
      const app = createTestApp()
      const payload = buildBootstrapPayload()

      const response = await request(app)
        .post('/api/moderation-categories/bootstrap')
        .send(payload)
        .expect(201)

      expect(response.body.channelId).toBe(payload.channelId)
      expect(response.body.createdCount).toBe(13)
      expect(response.body.skippedCount).toBe(0)
      expect(response.body.categories).toHaveLength(13)

      const catalogIds = response.body.categories.map(
        (c: { catalogId: string }) => c.catalogId
      )
      for (const entry of CANONICAL_MODERATION_CATALOG) {
        expect(catalogIds).toContain(entry.catalogId)
      }
    })

    it('returns 200 when nothing new is created', async () => {
      const app = createTestApp()
      const payload = buildBootstrapPayload()

      await request(app)
        .post('/api/moderation-categories/bootstrap')
        .send(payload)
        .expect(201)

      const response = await request(app)
        .post('/api/moderation-categories/bootstrap')
        .send(payload)
        .expect(200)

      expect(response.body.createdCount).toBe(0)
      expect(response.body.skippedCount).toBe(13)
      expect(response.body.categories).toHaveLength(13)
    })

    it('creates only missing categories when some already exist', async () => {
      const app = createTestApp()
      const channelId = uniqueTestId('ch')

      // Create a couple of categories via the single-create endpoint first
      await request(app)
        .post('/api/moderation-categories')
        .send({
          channelId,
          catalogId: 'SCAM',
          type: 'ban',
          label: 'Scam or phishing',
          definition: 'Scam content'
        })
        .expect(201)

      await request(app)
        .post('/api/moderation-categories')
        .send({
          channelId,
          catalogId: 'THREAT',
          type: 'timeout',
          label: 'Threat',
          definition: 'Threat content'
        })
        .expect(201)

      const payload = buildBootstrapPayload({ channelId })

      const response = await request(app)
        .post('/api/moderation-categories/bootstrap')
        .send(payload)
        .expect(201)

      expect(response.body.createdCount).toBe(11)
      expect(response.body.skippedCount).toBe(2)
      expect(response.body.categories).toHaveLength(13)
    })

    it('returns 409 without partial writes when an existing category conflicts on label and type', async () => {
      const app = createTestApp()
      const channelId = uniqueTestId('ch')

      await request(app)
        .post('/api/moderation-categories')
        .send({
          channelId,
          catalogId: 'THREAT',
          type: 'ban',
          label: 'Scam or phishing',
          definition: 'Conflicting existing category'
        })
        .expect(201)

      const payload = buildBootstrapPayload({ channelId })

      const response = await request(app)
        .post('/api/moderation-categories/bootstrap')
        .send(payload)
        .expect(409)

      expect(response.body.error).toMatch(/already uses label|duplicate/i)

      const listResponse = await request(app)
        .get(`/api/moderation-categories?channelId=${encodeURIComponent(channelId)}`)
        .expect(200)

      expect(listResponse.body).toHaveLength(1)
      expect(listResponse.body[0].catalogId).toBe('THREAT')
    })

    it('returns 201 with the full categories list including skipped ones', async () => {
      const app = createTestApp()
      const payload = buildBootstrapPayload()

      const response = await request(app)
        .post('/api/moderation-categories/bootstrap')
        .send(payload)
        .expect(201)

      for (const cat of response.body.categories) {
        expect(cat).toHaveProperty('id')
        expect(cat).toHaveProperty('channelId')
        expect(cat).toHaveProperty('catalogId')
        expect(cat).toHaveProperty('type')
        expect(cat).toHaveProperty('label')
        expect(cat).toHaveProperty('definition')
        expect(cat).toHaveProperty('enabled')
      }
    })

    it('response DTO excludes internal fields', async () => {
      const app = createTestApp()
      const payload = buildBootstrapPayload()

      const response = await request(app)
        .post('/api/moderation-categories/bootstrap')
        .send(payload)
        .expect(201)

      expect(response.body).not.toHaveProperty('_id')
      expect(response.body).not.toHaveProperty('__v')
      for (const cat of response.body.categories) {
        expect(cat).not.toHaveProperty('_id')
        expect(cat).not.toHaveProperty('__v')
        expect(cat).not.toHaveProperty('normalizedLabel')
      }
    })

    it('categories use labels and definitions from the catalog, not from the request body', async () => {
      const app = createTestApp()
      const payload = buildBootstrapPayload()

      await ModerationCatalog.findOneAndUpdate(
        { catalogId: 'SCAM' },
        {
          $set: {
            label: 'Updated Scam Label',
            definition: 'Updated scam definition from catalog'
          }
        }
      ).exec()

      const response = await request(app)
        .post('/api/moderation-categories/bootstrap')
        .send(payload)
        .expect(201)

      const scam = response.body.categories.find(
        (c: { catalogId: string }) => c.catalogId === 'SCAM'
      )

      expect(scam).toBeDefined()
      expect(scam.label).toBe('Updated Scam Label')
      expect(scam.definition).toBe('Updated scam definition from catalog')
    })

    it('respects individual enabled flags from the request', async () => {
      const app = createTestApp()
      const payload = buildBootstrapPayload()
      payload.categories = payload.categories.map(
        (cat: { catalogId: string; type: string; enabled: boolean }) =>
          cat.catalogId === 'SCAM' || cat.catalogId === 'SPAM'
            ? { ...cat, enabled: false }
            : cat
      )

      const response = await request(app)
        .post('/api/moderation-categories/bootstrap')
        .send(payload)
        .expect(201)

      const scam = response.body.categories.find(
        (c: { catalogId: string }) => c.catalogId === 'SCAM'
      )
      const spam = response.body.categories.find(
        (c: { catalogId: string }) => c.catalogId === 'SPAM'
      )
      const threat = response.body.categories.find(
        (c: { catalogId: string }) => c.catalogId === 'THREAT'
      )

      expect(scam.enabled).toBe(false)
      expect(spam.enabled).toBe(false)
      expect(threat.enabled).toBe(true)
    })

    it('respects individual type flags from the request', async () => {
      const app = createTestApp()
      const payload = buildBootstrapPayload()
      payload.categories = payload.categories.map(
        (cat: { catalogId: string; type: string; enabled: boolean }) =>
          cat.catalogId === 'SCAM' || cat.catalogId === 'SELF_PROMO'
            ? { ...cat, type: 'timeout' }
            : cat
      )

      const response = await request(app)
        .post('/api/moderation-categories/bootstrap')
        .send(payload)
        .expect(201)

      const scam = response.body.categories.find(
        (c: { catalogId: string }) => c.catalogId === 'SCAM'
      )
      const selfPromo = response.body.categories.find(
        (c: { catalogId: string }) => c.catalogId === 'SELF_PROMO'
      )
      const threat = response.body.categories.find(
        (c: { catalogId: string }) => c.catalogId === 'THREAT'
      )

      expect(scam.type).toBe('timeout')
      expect(selfPromo.type).toBe('timeout')
      expect(threat.type).toBe('ban')
    })

    it('defaults enabled to true when omitted from the request', async () => {
      const app = createTestApp()
      const payload = {
        channelId: uniqueTestId('ch'),
        categories: CANONICAL_MODERATION_CATALOG.map((entry) => ({
          catalogId: entry.catalogId,
          type: 'ban' as const
          // enabled intentionally omitted
        }))
      }

      const response = await request(app)
        .post('/api/moderation-categories/bootstrap')
        .send(payload)
        .expect(201)

      for (const cat of response.body.categories) {
        expect(cat.enabled).toBe(true)
      }
    })

    // --- Validation / rejection tests ---

    it('returns 400 when channelId is missing', async () => {
      const app = createTestApp()
      const payload = buildBootstrapPayload()
      delete (payload as Record<string, unknown>).channelId

      const response = await request(app)
        .post('/api/moderation-categories/bootstrap')
        .send(payload)
        .expect(400)

      expect(response.body.error).toMatch(/channelId/)
    })

    it('returns 400 when channelId is whitespace only', async () => {
      const app = createTestApp()
      const payload = buildBootstrapPayload({ channelId: '   ' })

      const response = await request(app)
        .post('/api/moderation-categories/bootstrap')
        .send(payload)
        .expect(400)

      expect(response.body.error).toMatch(/channelId/)
    })

    it('returns 400 when categories is missing', async () => {
      const app = createTestApp()
      const payload = { channelId: uniqueTestId('ch') }

      const response = await request(app)
        .post('/api/moderation-categories/bootstrap')
        .send(payload)
        .expect(400)

      expect(response.body.error).toMatch(/categories/)
    })

    it('returns 400 when categories is not an array', async () => {
      const app = createTestApp()

      const response = await request(app)
        .post('/api/moderation-categories/bootstrap')
        .send({ channelId: uniqueTestId('ch'), categories: 'not-an-array' })
        .expect(400)

      expect(response.body.error).toMatch(/categories/)
    })

    it('returns 400 when categories array is empty', async () => {
      const app = createTestApp()

      const response = await request(app)
        .post('/api/moderation-categories/bootstrap')
        .send({ channelId: uniqueTestId('ch'), categories: [] })
        .expect(400)

      expect(response.body.error).toMatch(/categories/)
    })

    it('returns 400 when a duplicate catalogId is present in the request', async () => {
      const app = createTestApp()
      const payload = buildBootstrapPayload()
      payload.categories[1] = {
        catalogId: 'SCAM',
        type: 'ban',
        enabled: true
      }

      const response = await request(app)
        .post('/api/moderation-categories/bootstrap')
        .send(payload)
        .expect(400)

      expect(response.body.error).toMatch(/[Dd]uplicate/)
    })

    it('returns 400 when an unknown catalogId is provided', async () => {
      const app = createTestApp()
      const payload = buildBootstrapPayload()
      payload.categories[0] = {
        catalogId: 'NOT_REAL',
        type: 'ban',
        enabled: true
      }

      const response = await request(app)
        .post('/api/moderation-categories/bootstrap')
        .send(payload)
        .expect(400)

      expect(response.body.error).toMatch(/[Uu]nknown/)
    })

    it('returns 400 when a required canonical catalog entry is missing', async () => {
      const app = createTestApp()
      const payload = buildBootstrapPayload()
      payload.categories = payload.categories.slice(0, -1)

      const response = await request(app)
        .post('/api/moderation-categories/bootstrap')
        .send(payload)
        .expect(400)

      expect(response.body.error).toMatch(/[Mm]issing/)
    })

    it('returns 400 when a category has an invalid type', async () => {
      const app = createTestApp()
      const payload = buildBootstrapPayload()
      payload.categories[0] = {
        catalogId: 'SCAM',
        type: 'invalid-type' as string,
        enabled: true
      }

      const response = await request(app)
        .post('/api/moderation-categories/bootstrap')
        .send(payload)
        .expect(400)

      expect(response.body.error).toMatch(/type/)
    })

    it('returns 400 when a category has a non-boolean enabled value', async () => {
      const app = createTestApp()
      const payload = {
        channelId: uniqueTestId('ch'),
        categories: CANONICAL_MODERATION_CATALOG.map((entry) => ({
          catalogId: entry.catalogId,
          type: 'ban',
          enabled: entry.catalogId === 'SCAM' ? ('yes' as unknown as boolean) : true
        }))
      }

      const response = await request(app)
        .post('/api/moderation-categories/bootstrap')
        .send(payload)
        .expect(400)

      expect(response.body.error).toMatch(/enabled/)
    })

    it('returns 400 when a category entry is not an object', async () => {
      const app = createTestApp()

      const response = await request(app)
        .post('/api/moderation-categories/bootstrap')
        .send({
          channelId: uniqueTestId('ch'),
          categories: [null]
        })
        .expect(400)

      expect(response.body.error).toMatch(/object/)
    })

    it('returns 400 when a category entry has a missing catalogId', async () => {
      const app = createTestApp()

      const response = await request(app)
        .post('/api/moderation-categories/bootstrap')
        .send({
          channelId: uniqueTestId('ch'),
          categories: [{ type: 'ban', enabled: true }]
        })
        .expect(400)

      expect(response.body.error).toMatch(/catalogId/)
    })

    it('returns 400 when the request body is missing entirely', async () => {
      const app = createTestApp()

      const response = await request(app)
        .post('/api/moderation-categories/bootstrap')
        .expect(400)

      expect(response.body.error).toMatch(/body/)
    })
  })
})
