import request from 'supertest'

import { ModerationCatalog } from '../../src/models/moderation-catalog.js'
import { ModerationCategory } from '../../src/models/moderation-category.js'
import { setEvoModerationDependencies } from '../../src/routes/moderation-routes.js'
import type {
  EvoModerationDependencies,
  EvoModerationStageDecision,
  EvoModerationStageModelInput,
  EvoModerationBanPromptVariables,
  EvoModerationNormalizeModelInput,
  EvoModerationNormalizePromptVariables,
  EvoModerationTimeoutPromptVariables
} from '../../src/services/evo-moderation-service.js'
import { seedModerationCatalog } from '../../src/services/moderation-catalog-service.js'
import { uniqueTestId } from '../helpers/factories.js'
import { createTestApp } from '../helpers/test-app.js'
import {
  clearTestDatabase,
  registerTestModel
} from '../helpers/test-database.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createModerationTestApp(
  overrides?: Partial<{
    normalizeResult: string
    banDecide: (
      input: EvoModerationStageModelInput
    ) => EvoModerationStageDecision | Promise<EvoModerationStageDecision>
    timeoutDecide: (
      input: EvoModerationStageModelInput
    ) => EvoModerationStageDecision | Promise<EvoModerationStageDecision>
  }>
) {
  const normalizeRender = vi.fn(
    async (_variables: EvoModerationNormalizePromptVariables) =>
      'rendered normalize prompt'
  )
  const normalizeModel = vi.fn(async (_input: EvoModerationNormalizeModelInput) => overrides?.normalizeResult ?? 'normalized text')
  const banRender = vi.fn(
    async (_variables: EvoModerationBanPromptVariables) =>
      'rendered ban prompt'
  )
  const banDecide = vi.fn(async (input: EvoModerationStageModelInput) =>
    overrides?.banDecide
      ? overrides.banDecide(input)
      : { action: 'IGNORE' as const, categoryId: null, reason: 'No violation' }
  )
  const timeoutRender = vi.fn(
    async (_variables: EvoModerationTimeoutPromptVariables) =>
      'rendered timeout prompt'
  )
  const timeoutDecide = vi.fn(async (input: EvoModerationStageModelInput) =>
    overrides?.timeoutDecide
      ? overrides.timeoutDecide(input)
      : {
          action: 'IGNORE' as const,
          categoryId: null,
          reason: 'No violation'
        }
  )

  const dependencies: EvoModerationDependencies = {
    normalizePromptRenderer: { render: normalizeRender },
    normalizeModel: {
      normalize: async (input) => normalizeModel(input)
    },
    banPromptRenderer: { render: banRender },
    banModel: { decide: banDecide },
    timeoutPromptRenderer: { render: timeoutRender },
    timeoutModel: { decide: timeoutDecide }
  }

  const app = createTestApp((expressApp) => {
    setEvoModerationDependencies(expressApp, dependencies)
  })

  return { app, normalizeRender, normalizeModel, banRender, banDecide, timeoutRender, timeoutDecide }
}

async function createCategoryViaApi(
  app: ReturnType<typeof createTestApp>,
  overrides: Partial<{
    channelId: string
    catalogId: string
    type: 'ban' | 'timeout'
    label: string
    definition: string
    enabled: boolean
  }> = {}
) {
  const payload = {
    channelId: uniqueTestId('ch'),
    catalogId: 'SCAM',
    type: 'ban' as const,
    label: 'Spam',
    definition: 'Unwanted messages',
    ...overrides
  }

  const response = await request(app)
    .post('/api/moderation-categories')
    .send(payload)

  return { payload, response }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Evo Moderation API', () => {
  beforeAll(() => {
    registerTestModel(ModerationCategory)
    registerTestModel(ModerationCatalog)
  })

  beforeEach(async () => {
    await clearTestDatabase()
    await seedModerationCatalog()
  })

  // ─── POST /api/moderation/evaluate validation ────────────────────────────

  describe('POST /api/moderation/evaluate', () => {
    it('returns 400 when request body is missing', async () => {
      const { app } = createModerationTestApp()

      const response = await request(app)
        .post('/api/moderation/evaluate')
        .expect(400)

      expect(response.body.error).toMatch(/Request body is required/)
    })

    it('returns 400 when channelId is missing', async () => {
      const { app } = createModerationTestApp()

      const response = await request(app)
        .post('/api/moderation/evaluate')
        .send({ message: 'Hello world' })
        .expect(400)

      expect(response.body.error).toMatch(/channelId/)
    })

    it('returns 400 when message is missing', async () => {
      const { app } = createModerationTestApp()

      const response = await request(app)
        .post('/api/moderation/evaluate')
        .send({ channelId: 'ch-1' })
        .expect(400)

      expect(response.body.error).toMatch(/message/)
    })

    it('returns 400 when channelId is empty string', async () => {
      const { app } = createModerationTestApp()

      const response = await request(app)
        .post('/api/moderation/evaluate')
        .send({ channelId: '  ', message: 'Hello' })
        .expect(400)

      expect(response.body.error).toMatch(/channelId/)
    })

    it('returns 400 when message is empty string', async () => {
      const { app } = createModerationTestApp()

      const response = await request(app)
        .post('/api/moderation/evaluate')
        .send({ channelId: 'ch-1', message: '  ' })
        .expect(400)

      expect(response.body.error).toMatch(/message/)
    })

    // ─── Normalize gate behavior ─────────────────────────────────────────

    it('does not normalize messages with no non-ASCII characters', async () => {
      const { app, normalizeModel } = createModerationTestApp()

      const response = await request(app)
        .post('/api/moderation/evaluate')
        .send({ channelId: 'ch-1', message: 'Hello world' })
        .expect(200)

      expect(response.body.workflow.normalized).toBe(false)
      expect(response.body.workflow.unicodeCount).toBe(0)
      expect(normalizeModel).not.toHaveBeenCalled()
    })

    it('does not normalize messages with exactly one non-ASCII character', async () => {
      const { app, normalizeModel } = createModerationTestApp()

      const response = await request(app)
        .post('/api/moderation/evaluate')
        .send({ channelId: 'ch-1', message: 'Hello çorld' })
        .expect(200)

      expect(response.body.workflow.normalized).toBe(false)
      expect(response.body.workflow.unicodeCount).toBe(1)
      expect(normalizeModel).not.toHaveBeenCalled()
    })

    it('normalizes messages with more than one non-ASCII character', async () => {
      const { app, normalizeModel } = createModerationTestApp({
        banDecide: () => ({
          action: 'IGNORE' as const,
          categoryId: null,
          reason: 'No violation'
        })
      })

      const response = await request(app)
        .post('/api/moderation/evaluate')
        .send({ channelId: 'ch-1', message: 'Kaç yaşındasın' })
        .expect(200)

      expect(response.body.workflow.normalized).toBe(true)
      expect(response.body.workflow.unicodeCount).toBe(4)
      expect(normalizeModel).toHaveBeenCalledTimes(1)
    })

    // ─── Ban short-circuits timeout ──────────────────────────────────────

    it('BAN short-circuits timeout and stops immediately', async () => {
      const { app, banDecide, timeoutDecide } = createModerationTestApp({
        banDecide: () => ({
          action: 'BAN' as const,
          categoryId: 'SCAM',
          reason: 'Phishing detected'
        })
      })

      const channelId = uniqueTestId('ch')
      await createCategoryViaApi(app, {
        channelId,
        catalogId: 'SCAM',
        type: 'ban',
        label: 'Scam',
        definition: 'Scam definition'
      })
      await createCategoryViaApi(app, {
        channelId,
        catalogId: 'INSULT',
        type: 'timeout',
        label: 'Insult',
        definition: 'Insult definition'
      })

      const response = await request(app)
        .post('/api/moderation/evaluate')
        .send({
          channelId,
          message: 'Free mod giveaway, claim it by entering your login'
        })
        .expect(200)

      expect(response.body).toMatchObject({
        agent: 'evo-moderation',
        action: 'BAN',
        catalogId: 'SCAM',
        reason: 'Phishing detected',
        stage: 'ban'
      })
      expect(response.body.workflow).toMatchObject({
        receivedMessage: true,
        banSkipped: false,
        timeoutSkipped: true,
        banAction: 'BAN',
        timeoutAction: null
      })
      expect(banDecide).toHaveBeenCalledTimes(1)
      expect(timeoutDecide).not.toHaveBeenCalled()
    })

    // ─── Timeout runs after ban returns IGNORE ───────────────────────────

    it('TIMEOUT runs after ban returns IGNORE', async () => {
      const { app, banDecide, timeoutDecide } = createModerationTestApp({
        banDecide: () => ({
          action: 'IGNORE' as const,
          categoryId: null,
          reason: 'No ban violation'
        }),
        timeoutDecide: () => ({
          action: 'TIMEOUT' as const,
          categoryId: 'INSULT',
          reason: 'Direct name-calling'
        })
      })

      const channelId = uniqueTestId('ch')
      await createCategoryViaApi(app, {
        channelId,
        catalogId: 'THREAT',
        type: 'ban',
        label: 'Threat',
        definition: 'Threat definition'
      })
      await createCategoryViaApi(app, {
        channelId,
        catalogId: 'INSULT',
        type: 'timeout',
        label: 'Insult',
        definition: 'Direct insults'
      })

      const response = await request(app)
        .post('/api/moderation/evaluate')
        .send({ channelId, message: "You're actually an idiot" })
        .expect(200)

      expect(response.body).toMatchObject({
        action: 'TIMEOUT',
        catalogId: 'INSULT',
        reason: 'Direct name-calling',
        stage: 'timeout'
      })
      expect(response.body.workflow).toMatchObject({
        banAction: 'IGNORE',
        timeoutAction: 'TIMEOUT',
        banSkipped: false,
        timeoutSkipped: false
      })
      expect(banDecide).toHaveBeenCalledTimes(1)
      expect(timeoutDecide).toHaveBeenCalledTimes(1)
    })

    // ─── No-category stage skips ─────────────────────────────────────────

    it('skips ban stage when no ban categories are enabled', async () => {
      const { app, banDecide, timeoutDecide } = createModerationTestApp({
        timeoutDecide: () => ({
          action: 'TIMEOUT' as const,
          categoryId: 'SELF_PROMO',
          reason: 'Channel advertising'
        })
      })

      const channelId = uniqueTestId('ch')
      await createCategoryViaApi(app, {
        channelId,
        catalogId: 'SELF_PROMO',
        type: 'timeout',
        label: 'Self-promotion',
        definition: 'Self-promotion definition'
      })

      const response = await request(app)
        .post('/api/moderation/evaluate')
        .send({ channelId, message: 'Check out my stream' })
        .expect(200)

      expect(response.body).toMatchObject({
        action: 'TIMEOUT',
        catalogId: 'SELF_PROMO'
      })
      expect(response.body.workflow).toMatchObject({
        banSkipped: true,
        banAction: 'IGNORE',
        timeoutSkipped: false
      })
      expect(banDecide).not.toHaveBeenCalled()
      expect(timeoutDecide).toHaveBeenCalledTimes(1)
    })

    it('skips timeout stage when no timeout categories are enabled', async () => {
      const { app, banDecide, timeoutDecide } = createModerationTestApp({
        banDecide: () => ({
          action: 'IGNORE' as const,
          categoryId: null,
          reason: 'No violation'
        })
      })

      const channelId = uniqueTestId('ch')
      await createCategoryViaApi(app, {
        channelId,
        catalogId: 'SCAM',
        type: 'ban',
        label: 'Scam',
        definition: 'Scam definition'
      })

      const response = await request(app)
        .post('/api/moderation/evaluate')
        .send({ channelId, message: 'Hello world' })
        .expect(200)

      expect(response.body).toMatchObject({
        action: 'IGNORE',
        catalogId: null,
        stage: 'timeout'
      })
      expect(response.body.workflow).toMatchObject({
        banSkipped: false,
        timeoutSkipped: true,
        timeoutAction: 'IGNORE',
        timeoutReason: 'No enabled timeout categories'
      })
      expect(banDecide).toHaveBeenCalledTimes(1)
      expect(timeoutDecide).not.toHaveBeenCalled()
    })

    it('returns IGNORE with both stages skipped when no categories exist', async () => {
      const { app, banDecide, timeoutDecide } = createModerationTestApp()

      const response = await request(app)
        .post('/api/moderation/evaluate')
        .send({ channelId: 'empty-channel', message: 'Hello world' })
        .expect(200)

      expect(response.body).toMatchObject({
        action: 'IGNORE',
        catalogId: null,
        stage: 'timeout'
      })
      expect(response.body.workflow).toMatchObject({
        banSkipped: true,
        timeoutSkipped: true,
        banCategoriesCount: 0,
        timeoutCategoriesCount: 0
      })
      expect(banDecide).not.toHaveBeenCalled()
      expect(timeoutDecide).not.toHaveBeenCalled()
    })

    // ─── Workflow ignore propagation ───────────────────────────────────────

    it('returns IGNORE when injected moderation dependencies ignore the message', async () => {
      const { app } = createModerationTestApp({
        banDecide: () => ({
          action: 'IGNORE' as const,
          categoryId: null,
          reason: 'No violation'
        }),
        timeoutDecide: () => ({
          action: 'IGNORE' as const,
          categoryId: null,
          reason: 'Normal chat, no violation'
        })
      })

      const channelId = uniqueTestId('ch')
      await createCategoryViaApi(app, {
        channelId,
        catalogId: 'SCAM',
        type: 'ban',
        label: 'Scam',
        definition: 'Scam definition'
      })
      await createCategoryViaApi(app, {
        channelId,
        catalogId: 'INSULT',
        type: 'timeout',
        label: 'Insult',
        definition: 'Direct insults'
      })

      const response = await request(app)
        .post('/api/moderation/evaluate')
        .send({ channelId, message: 'Love the energy today' })
        .expect(200)

      expect(response.body).toMatchObject({
        agent: 'evo-moderation',
        action: 'IGNORE',
        stage: 'timeout'
      })
    })

    // ─── Only enabled categories are passed ───────────────────────────────

    it('only passes enabled categories to the model', async () => {
      const { app } = createModerationTestApp({
        banDecide: () => ({
          action: 'IGNORE' as const,
          categoryId: null,
          reason: 'No violation'
        }),
        timeoutDecide: () => ({
          action: 'IGNORE' as const,
          categoryId: null,
          reason: 'No violation'
        })
      })

      const channelId = uniqueTestId('ch')
      await createCategoryViaApi(app, {
        channelId,
        catalogId: 'SCAM',
        type: 'ban',
        label: 'Scam',
        definition: 'Scam definition',
        enabled: true
      })
      await createCategoryViaApi(app, {
        channelId,
        catalogId: 'THREAT',
        type: 'ban',
        label: 'Threat',
        definition: 'Threat definition',
        enabled: false
      })
      await createCategoryViaApi(app, {
        channelId,
        catalogId: 'INSULT',
        type: 'timeout',
        label: 'Insult',
        definition: 'Insult definition',
        enabled: true
      })
      await createCategoryViaApi(app, {
        channelId,
        catalogId: 'TROLLING',
        type: 'timeout',
        label: 'Trolling',
        definition: 'Trolling definition',
        enabled: false
      })

      const response = await request(app)
        .post('/api/moderation/evaluate')
        .send({ channelId, message: 'Hello' })
        .expect(200)

      expect(response.body.workflow.banCategoriesCount).toBe(1)
      expect(response.body.workflow.timeoutCategoriesCount).toBe(1)
    })

    // ─── Stage grouping by per-channel type ───────────────────────────────

    it('groups categories by type and scopes to channel', async () => {
      const { app } = createModerationTestApp({
        banDecide: () => ({
          action: 'IGNORE' as const,
          categoryId: null,
          reason: 'No violation'
        }),
        timeoutDecide: () => ({
          action: 'IGNORE' as const,
          categoryId: null,
          reason: 'No violation'
        })
      })

      const channelId = uniqueTestId('ch')
      // Create ban categories
      await createCategoryViaApi(app, {
        channelId,
        catalogId: 'SCAM',
        type: 'ban',
        label: 'Scam',
        definition: 'Scam definition'
      })
      await createCategoryViaApi(app, {
        channelId,
        catalogId: 'THREAT',
        type: 'ban',
        label: 'Threat',
        definition: 'Threat definition'
      })
      // Create timeout categories
      await createCategoryViaApi(app, {
        channelId,
        catalogId: 'INSULT',
        type: 'timeout',
        label: 'Insult',
        definition: 'Insult definition'
      })
      await createCategoryViaApi(app, {
        channelId,
        catalogId: 'SELF_PROMO',
        type: 'timeout',
        label: 'Self-promotion',
        definition: 'Self-promotion definition'
      })

      const response = await request(app)
        .post('/api/moderation/evaluate')
        .send({ channelId, message: 'Hello' })
        .expect(200)

      expect(response.body.workflow.banCategoriesCount).toBe(2)
      expect(response.body.workflow.timeoutCategoriesCount).toBe(2)
    })

    // ─── Legacy workflow fixture cases ────────────────────────────────────

    it('BAN-ACTIVE-SCAM: selected scam category bans phishing', async () => {
      const { app } = createModerationTestApp({
        banDecide: () => ({
          action: 'BAN' as const,
          categoryId: 'SCAM',
          reason: 'Phishing link detected'
        })
      })

      const channelId = uniqueTestId('ch')
      await createCategoryViaApi(app, {
        channelId,
        catalogId: 'SCAM',
        type: 'ban',
        label: 'Scam or phishing',
        definition:
          'Attempts to trick people into sending money or crypto, sharing credentials or wallet keys, or trusting fake giveaways, verification flows, recovery help, or guaranteed-return offers such as "send 1 BTC and get 2 BTC back."'
      })

      const response = await request(app)
        .post('/api/moderation/evaluate')
        .send({
          channelId,
          message:
            'Free mod giveaway, claim it by entering your login and password at http://claim-rewards.example'
        })
        .expect(200)

      expect(response.body).toMatchObject({
        action: 'BAN',
        catalogId: 'SCAM',
        stage: 'ban'
      })
    })

    it('BAN-ACTIVE-THREAT: threat bans and short-circuits timeout', async () => {
      const { app, timeoutDecide } = createModerationTestApp({
        banDecide: () => ({
          action: 'BAN' as const,
          categoryId: 'THREAT',
          reason: 'Credible violent threat'
        })
      })

      const channelId = uniqueTestId('ch')
      await createCategoryViaApi(app, {
        channelId,
        catalogId: 'THREAT',
        type: 'ban',
        label: 'Threat',
        definition:
          'Threats of violence, wishes of harm, incitement, or targeted intimidation that imply real-world danger or retaliation.'
      })
      await createCategoryViaApi(app, {
        channelId,
        catalogId: 'INSULT',
        type: 'timeout',
        label: 'Insult',
        definition:
          'One-off personal abuse or name-calling aimed at a person, such as "idiot" or "shut up," without identity-based hate or sustained targeting.'
      })

      const response = await request(app)
        .post('/api/moderation/evaluate')
        .send({
          channelId,
          message: "I know your street and I'm coming after you"
        })
        .expect(200)

      expect(response.body).toMatchObject({
        action: 'BAN',
        catalogId: 'THREAT',
        stage: 'ban'
      })
      expect(timeoutDecide).not.toHaveBeenCalled()
    })

    it('BAN-INACTIVE-MALWARE: unselected categories cause IGNORE', async () => {
      const { app, banDecide, timeoutDecide } = createModerationTestApp()

      // No categories enabled for this channel
      const channelId = uniqueTestId('ch')

      const response = await request(app)
        .post('/api/moderation/evaluate')
        .send({
          channelId,
          message:
            'This FPS unlocker works on stream games, download http://files.example/fps_unlocker.exe'
        })
        .expect(200)

      expect(response.body).toMatchObject({
        action: 'IGNORE',
        stage: 'timeout'
      })
      expect(banDecide).not.toHaveBeenCalled()
      expect(timeoutDecide).not.toHaveBeenCalled()
    })

    it('TIMEOUT-ACTIVE-SELF-PROMO: selected self-promo category times out', async () => {
      const { app } = createModerationTestApp({
        timeoutDecide: () => ({
          action: 'TIMEOUT' as const,
          categoryId: 'SELF_PROMO',
          reason: 'Channel advertising'
        })
      })

      const channelId = uniqueTestId('ch')
      await createCategoryViaApi(app, {
        channelId,
        catalogId: 'SELF_PROMO',
        type: 'timeout',
        label: 'Self-promotion',
        definition:
          'Promoting your own channel, social account, server, store, referral code, or asking viewers to follow, sub, DM, or go elsewhere for non-deceptive promotion.'
      })

      const response = await request(app)
        .post('/api/moderation/evaluate')
        .send({
          channelId,
          message:
            "I'm live too right now at twitch.tv/mychannel, come through after this"
        })
        .expect(200)

      expect(response.body).toMatchObject({
        action: 'TIMEOUT',
        catalogId: 'SELF_PROMO',
        stage: 'timeout'
      })
    })

    it('TIMEOUT-ACTIVE-INSULT: selected insult category times out name-calling', async () => {
      const { app } = createModerationTestApp({
        timeoutDecide: () => ({
          action: 'TIMEOUT' as const,
          categoryId: 'INSULT',
          reason: 'Direct name-calling'
        })
      })

      const channelId = uniqueTestId('ch')
      await createCategoryViaApi(app, {
        channelId,
        catalogId: 'INSULT',
        type: 'timeout',
        label: 'Insult',
        definition:
          'One-off personal abuse or name-calling aimed at a person, such as "idiot" or "shut up," without identity-based hate or sustained targeting.'
      })

      const response = await request(app)
        .post('/api/moderation/evaluate')
        .send({ channelId, message: "You're actually an idiot, stop typing in chat" })
        .expect(200)

      expect(response.body).toMatchObject({
        action: 'TIMEOUT',
        catalogId: 'INSULT',
        stage: 'timeout'
      })
    })

    it('TIMEOUT-ACTIVE-SYMBOL-FLOOD: selected symbol flood category times out', async () => {
      const { app, normalizeModel } = createModerationTestApp({
        timeoutDecide: () => ({
          action: 'TIMEOUT' as const,
          categoryId: 'SYMBOL_FLOOD',
          reason: 'Excessive punctuation spam'
        })
      })

      const channelId = uniqueTestId('ch')
      await createCategoryViaApi(app, {
        channelId,
        catalogId: 'SYMBOL_FLOOD',
        type: 'timeout',
        label: 'Symbol flood',
        definition:
          'Messages dominated by repeated caps, emoji, punctuation, symbols, or unreadable character walls rather than meaningful text.'
      })

      const response = await request(app)
        .post('/api/moderation/evaluate')
        .send({
          channelId,
          message:
            '????????????????????????????????????????????????????????????????????'
        })
        .expect(200)

      expect(response.body).toMatchObject({
        action: 'TIMEOUT',
        catalogId: 'SYMBOL_FLOOD'
      })
      // Symbol flood message has no unicode chars > 1, so no normalization
      expect(normalizeModel).not.toHaveBeenCalled()
    })

    it('WORKFLOW-NORMAL-IGNORE: normal chat is ignored', async () => {
      const { app } = createModerationTestApp({
        banDecide: () => ({
          action: 'IGNORE' as const,
          categoryId: null,
          reason: 'No violation'
        }),
        timeoutDecide: () => ({
          action: 'IGNORE' as const,
          categoryId: null,
          reason: 'No violation'
        })
      })

      const channelId = uniqueTestId('ch')
      await createCategoryViaApi(app, {
        channelId,
        catalogId: 'SCAM',
        type: 'ban',
        label: 'Scam or phishing',
        definition:
          'Attempts to trick people into sending money or crypto, sharing credentials or wallet keys, or trusting fake giveaways, verification flows, recovery help, or guaranteed-return offers such as "send 1 BTC and get 2 BTC back."'
      })
      await createCategoryViaApi(app, {
        channelId,
        catalogId: 'THREAT',
        type: 'ban',
        label: 'Threat',
        definition:
          'Threats of violence, wishes of harm, incitement, or targeted intimidation that imply real-world danger or retaliation.'
      })
      await createCategoryViaApi(app, {
        channelId,
        catalogId: 'SELF_PROMO',
        type: 'timeout',
        label: 'Self-promotion',
        definition:
          'Promoting your own channel, social account, server, store, referral code, or asking viewers to follow, sub, DM, or go elsewhere for non-deceptive promotion.'
      })
      await createCategoryViaApi(app, {
        channelId,
        catalogId: 'INSULT',
        type: 'timeout',
        label: 'Insult',
        definition:
          'One-off personal abuse or name-calling aimed at a person, such as "idiot" or "shut up," without identity-based hate or sustained targeting.'
      })

      const response = await request(app)
        .post('/api/moderation/evaluate')
        .send({ channelId, message: 'Love the energy today, this stream has been chill' })
        .expect(200)

      expect(response.body).toMatchObject({
        action: 'IGNORE',
        catalogId: null,
        stage: 'timeout'
      })
      expect(response.body.workflow).toMatchObject({
        banCategoriesCount: 2,
        timeoutCategoriesCount: 2,
        banSkipped: false,
        timeoutSkipped: false
      })
    })
  })
})
