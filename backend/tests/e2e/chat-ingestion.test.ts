import request from 'supertest'

import { ChatCommand } from '../../src/models/chat-command.js'
import { ChatEvent } from '../../src/models/chat-event.js'
import { ModerationCatalog } from '../../src/models/moderation-catalog.js'
import { ModerationCategory } from '../../src/models/moderation-category.js'
import { QnaEntry } from '../../src/models/qna-entry.js'
import { setQnaAgentDependencies } from '../../src/routes/qna-routes.js'
import { setEvoModerationDependencies } from '../../src/routes/moderation-routes.js'
import type {
  QnaAgentDependencies,
  QnaAgentModelDecision,
  QnaAgentModelInput,
  QnaPromptVariables
} from '../../src/services/qna-agent-service.js'
import type {
  EvoModerationDependencies,
  EvoModerationStageDecision,
  EvoModerationStageModelInput,
  EvoModerationBanPromptVariables,
  EvoModerationNormalizePromptVariables,
  EvoModerationTimeoutPromptVariables,
  EvoModerationNormalizeModelInput
} from '../../src/services/evo-moderation-service.js'
import { seedModerationCatalog } from '../../src/services/moderation-catalog-service.js'
import { uniqueTestId } from '../helpers/factories.js'
import { createTestApp } from '../helpers/test-app.js'
import {
  clearTestDatabase,
  registerTestModel
} from '../helpers/test-database.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface IngestionTestOverrides {
  qnaDecide?: (
    input: QnaAgentModelInput
  ) => QnaAgentModelDecision | Promise<QnaAgentModelDecision>
  moderationBanDecide?: (
    input: EvoModerationStageModelInput
  ) => EvoModerationStageDecision | Promise<EvoModerationStageDecision>
  moderationTimeoutDecide?: (
    input: EvoModerationStageModelInput
  ) => EvoModerationStageDecision | Promise<EvoModerationStageDecision>
}

function createChatIngestionTestApp(overrides: IngestionTestOverrides = {}) {
  // Fake Q&A dependencies (matches pattern from qna.test.ts)
  const qnaRender = vi.fn(
    async (_variables: QnaPromptVariables) => 'rendered qna prompt'
  )
  const qnaModelDecide = vi.fn(
    async (input: QnaAgentModelInput) => {
      if (overrides.qnaDecide) {
        return overrides.qnaDecide(input)
      }
      return {
        question: '',
        response: ''
      }
    }
  )
  const qnaDeps: QnaAgentDependencies = {
    promptRenderer: { render: qnaRender },
    model: { decide: qnaModelDecide }
  }

  // Fake Evo moderation dependencies (matches pattern from moderation.test.ts)
  const normalizeRender = vi.fn(
    async (_variables: EvoModerationNormalizePromptVariables) =>
      'rendered normalize prompt'
  )
  const normalizeModel = vi.fn(
    async (_input: EvoModerationNormalizeModelInput) => 'normalized text'
  )
  const banRender = vi.fn(
    async (_variables: EvoModerationBanPromptVariables) =>
      'rendered ban prompt'
  )
  const banDecide = vi.fn(
    async (input: EvoModerationStageModelInput) => {
      if (overrides.moderationBanDecide) {
        return overrides.moderationBanDecide(input)
      }
      return {
        action: 'IGNORE' as const,
        categoryId: null,
        reason: 'No violation'
      }
    }
  )
  const timeoutRender = vi.fn(
    async (_variables: EvoModerationTimeoutPromptVariables) =>
      'rendered timeout prompt'
  )
  const timeoutDecide = vi.fn(
    async (input: EvoModerationStageModelInput) => {
      if (overrides.moderationTimeoutDecide) {
        return overrides.moderationTimeoutDecide(input)
      }
      return {
        action: 'IGNORE' as const,
        categoryId: null,
        reason: 'No violation'
      }
    }
  )
  const evoDeps: EvoModerationDependencies = {
    normalizePromptRenderer: { render: normalizeRender },
    normalizeModel: {
      normalize: async (input) => normalizeModel(input)
    },
    banPromptRenderer: { render: banRender },
    banModel: { decide: banDecide },
    timeoutPromptRenderer: { render: timeoutRender },
    timeoutModel: { decide: timeoutDecide }
  }

  // The route is auto-registered in app.ts; we only need to inject deps
  const app = createTestApp((expressApp) => {
    setQnaAgentDependencies(expressApp, qnaDeps)
    setEvoModerationDependencies(expressApp, evoDeps)
  })

  return {
    app,
    qnaRender,
    qnaModelDecide,
    normalizeRender,
    normalizeModel,
    banRender,
    banDecide,
    timeoutRender,
    timeoutDecide
  }
}

async function createCategory(
  app: ReturnType<typeof createTestApp>,
  overrides: Partial<{
    channelId: string
    catalogId: string
    type: 'ban' | 'timeout'
    label: string
    definition: string
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

describe('Chat Ingestion API', () => {
  beforeAll(() => {
    registerTestModel(ChatEvent)
    registerTestModel(ChatCommand)
    registerTestModel(QnaEntry)
    registerTestModel(ModerationCategory)
    registerTestModel(ModerationCatalog)
  })

  beforeEach(async () => {
    await clearTestDatabase()
    await seedModerationCatalog()
  })

  // ─── POST /api/chat/ingest validation ──────────────────────────────────

  describe('POST /api/chat/ingest validation', () => {
    it('returns 400 when request body is missing', async () => {
      const { app } = createChatIngestionTestApp()

      const response = await request(app)
        .post('/api/chat/ingest')
        .expect(400)

      expect(response.body.error).toMatch(/Request body is required/)
    })

    it('returns 400 when channelId is missing', async () => {
      const { app } = createChatIngestionTestApp()

      const response = await request(app)
        .post('/api/chat/ingest')
        .send({
          messageId: uniqueTestId('msg'),
          authorExternalId: uniqueTestId('author'),
          channelExternalId: uniqueTestId('ext-ch'),
          platform: 'youtube',
          sentAt: new Date().toISOString(),
          text: 'Hello world'
        })
        .expect(400)

      expect(response.body.error).toMatch(/channelId/)
    })

    it('returns 400 when messageId is missing', async () => {
      const { app } = createChatIngestionTestApp()

      const response = await request(app)
        .post('/api/chat/ingest')
        .send({
          channelId: uniqueTestId('ch'),
          authorExternalId: uniqueTestId('author'),
          channelExternalId: uniqueTestId('ext-ch'),
          platform: 'youtube',
          sentAt: new Date().toISOString(),
          text: 'Hello world'
        })
        .expect(400)

      expect(response.body.error).toMatch(/messageId/)
    })

    it('returns 400 when authorExternalId is missing', async () => {
      const { app } = createChatIngestionTestApp()

      const response = await request(app)
        .post('/api/chat/ingest')
        .send({
          channelId: uniqueTestId('ch'),
          messageId: uniqueTestId('msg'),
          channelExternalId: uniqueTestId('ext-ch'),
          platform: 'youtube',
          sentAt: new Date().toISOString(),
          text: 'Hello world'
        })
        .expect(400)

      expect(response.body.error).toMatch(/authorExternalId/)
    })

    it('returns 400 when channelExternalId is missing', async () => {
      const { app } = createChatIngestionTestApp()

      const response = await request(app)
        .post('/api/chat/ingest')
        .send({
          channelId: uniqueTestId('ch'),
          messageId: uniqueTestId('msg'),
          authorExternalId: uniqueTestId('author'),
          platform: 'youtube',
          sentAt: new Date().toISOString(),
          text: 'Hello world'
        })
        .expect(400)

      expect(response.body.error).toMatch(/channelExternalId/)
    })

    it('returns 400 when platform is missing', async () => {
      const { app } = createChatIngestionTestApp()

      const response = await request(app)
        .post('/api/chat/ingest')
        .send({
          channelId: uniqueTestId('ch'),
          messageId: uniqueTestId('msg'),
          authorExternalId: uniqueTestId('author'),
          channelExternalId: uniqueTestId('ext-ch'),
          sentAt: new Date().toISOString(),
          text: 'Hello world'
        })
        .expect(400)

      expect(response.body.error).toMatch(/platform/)
    })

    it('returns 400 when platform is not a valid value', async () => {
      const { app } = createChatIngestionTestApp()

      const response = await request(app)
        .post('/api/chat/ingest')
        .send({
          channelId: uniqueTestId('ch'),
          messageId: uniqueTestId('msg'),
          authorExternalId: uniqueTestId('author'),
          channelExternalId: uniqueTestId('ext-ch'),
          platform: 'discord',
          sentAt: new Date().toISOString(),
          text: 'Hello world'
        })
        .expect(400)

      expect(response.body.error).toMatch(/platform/)
    })

    it('returns 400 when sentAt is missing', async () => {
      const { app } = createChatIngestionTestApp()

      const response = await request(app)
        .post('/api/chat/ingest')
        .send({
          channelId: uniqueTestId('ch'),
          messageId: uniqueTestId('msg'),
          authorExternalId: uniqueTestId('author'),
          channelExternalId: uniqueTestId('ext-ch'),
          platform: 'youtube',
          text: 'Hello world'
        })
        .expect(400)

      expect(response.body.error).toMatch(/sentAt/)
    })

    it('returns 400 when text is missing', async () => {
      const { app } = createChatIngestionTestApp()

      const response = await request(app)
        .post('/api/chat/ingest')
        .send({
          channelId: uniqueTestId('ch'),
          messageId: uniqueTestId('msg'),
          authorExternalId: uniqueTestId('author'),
          channelExternalId: uniqueTestId('ext-ch'),
          platform: 'youtube',
          sentAt: new Date().toISOString()
        })
        .expect(400)

      expect(response.body.error).toMatch(/text/)
    })

    it('returns 400 when required fields are empty strings', async () => {
      const { app } = createChatIngestionTestApp()

      const response = await request(app)
        .post('/api/chat/ingest')
        .send({
          channelId: '  ',
          messageId: uniqueTestId('msg'),
          authorExternalId: uniqueTestId('author'),
          channelExternalId: uniqueTestId('ext-ch'),
          platform: 'youtube',
          sentAt: new Date().toISOString(),
          text: 'Hello world'
        })
        .expect(400)

      expect(response.body.error).toMatch(/channelId/)
    })

    it('returns 400 when sentAt is an empty string', async () => {
      const { app } = createChatIngestionTestApp()

      const response = await request(app)
        .post('/api/chat/ingest')
        .send({
          channelId: uniqueTestId('ch'),
          messageId: uniqueTestId('msg'),
          authorExternalId: uniqueTestId('author'),
          channelExternalId: uniqueTestId('ext-ch'),
          platform: 'youtube',
          sentAt: '   ',
          text: 'Hello world'
        })
        .expect(400)

      expect(response.body.error).toMatch(/sentAt/)
    })

    it('returns 400 when sentAt is not a valid date string', async () => {
      const { app } = createChatIngestionTestApp()

      const response = await request(app)
        .post('/api/chat/ingest')
        .send({
          channelId: uniqueTestId('ch'),
          messageId: uniqueTestId('msg'),
          authorExternalId: uniqueTestId('author'),
          channelExternalId: uniqueTestId('ext-ch'),
          platform: 'youtube',
          sentAt: 'not-a-date',
          text: 'Hello world'
        })
        .expect(400)

      expect(response.body.error).toMatch(/valid date string/i)
    })
  })

  // ─── POST /api/chat/ingest successful ingest ──────────────────────────

  describe('successful ingest', () => {
    it('returns 201 with combined Q&A and moderation output', async () => {
      const { app, qnaModelDecide } = createChatIngestionTestApp({
        qnaDecide: () => ({
          question: '',
          response: ''
        })
      })

      const payload = {
        channelId: uniqueTestId('ch'),
        messageId: uniqueTestId('msg'),
        authorExternalId: uniqueTestId('author'),
        channelExternalId: uniqueTestId('ext-ch'),
        platform: 'youtube' as const,
        sentAt: new Date().toISOString(),
        text: 'Hello world, how is everyone?'
      }

      const response = await request(app)
        .post('/api/chat/ingest')
        .send(payload)
        .expect(201)

      // Verify top-level structure
      expect(response.body.duplicate).toBe(false)

      // Verify event shape
      expect(response.body.event).toMatchObject({
        messageId: payload.messageId,
        channelId: payload.channelId,
        authorExternalId: payload.authorExternalId,
        channelExternalId: payload.channelExternalId,
        platform: payload.platform,
        text: payload.text
      })
      expect(response.body.event.id).toBeDefined()
      expect(response.body.event).not.toHaveProperty('_id')
      expect(response.body.event).not.toHaveProperty('__v')

      expect(response.body.command).toEqual({ matched: false })

      // Verify Q&A shape (no-match)
      expect(response.body.qna).toMatchObject({
        agent: 'qna',
        matched: false,
        action: 'DO_NOTHING'
      })
      expect(response.body.qna.workflow).toBeDefined()
      expect(response.body.qna).not.toHaveProperty('answer')
      expect(response.body.qna).not.toHaveProperty('entry')

      // Verify moderation shape
      expect(response.body.moderation).toMatchObject({
        agent: 'evo-moderation',
        action: expect.any(String),
        stage: expect.any(String)
      })
      expect(response.body.moderation).toHaveProperty('catalogId')
      expect(response.body.moderation.workflow).toBeDefined()

      // Verify workflows were run
      expect(qnaModelDecide).toHaveBeenCalledTimes(1)
    })

    it('returns 201 with skipped Q&A and normal moderation when skipQna is true', async () => {
      const { app, qnaModelDecide } = createChatIngestionTestApp({
        qnaDecide: () => ({
          question: '',
          response: ''
        })
      })

      const payload = {
        channelId: uniqueTestId('ch'),
        messageId: uniqueTestId('msg'),
        authorExternalId: uniqueTestId('author'),
        channelExternalId: uniqueTestId('ext-ch'),
        platform: 'youtube' as const,
        sentAt: new Date().toISOString(),
        text: 'Startup history message',
        skipQna: true
      }

      const response = await request(app)
        .post('/api/chat/ingest')
        .send(payload)
        .expect(201)

      expect(response.body.duplicate).toBe(false)
      expect(response.body.event.text).toBe('Startup history message')
      expect(response.body.command).toEqual({ matched: false })

      // Q&A should be skipped
      expect(response.body.qna).toMatchObject({
        agent: 'qna',
        matched: false,
        action: 'DO_NOTHING',
        workflow: {
          reason: 'HISTORY_SKIPPED',
          promptRendered: false,
          retrievedEntries: 0,
          retrievedQnaEntries: []
        }
      })
      expect(qnaModelDecide).not.toHaveBeenCalled()

      // Moderation should still run
      expect(response.body.moderation).toMatchObject({
        agent: 'evo-moderation',
        action: expect.any(String),
        stage: expect.any(String)
      })
      expect(response.body.moderation.workflow).toBeDefined()
    })

    it('returns 201 with self-message skips for Q&A and moderation', async () => {
      const { app, qnaModelDecide, banDecide, timeoutDecide } =
        createChatIngestionTestApp()

      const response = await request(app)
        .post('/api/chat/ingest')
        .send({
          channelId: uniqueTestId('ch'),
          messageId: uniqueTestId('msg'),
          authorExternalId: 'channel-owner-1',
          channelExternalId: 'channel-owner-1',
          platform: 'youtube',
          sentAt: new Date().toISOString(),
          text: '!discord'
        })
        .expect(201)

      expect(response.body.duplicate).toBe(false)
      expect(response.body.qna).toMatchObject({
        agent: 'qna',
        matched: false,
        action: 'DO_NOTHING',
        workflow: {
          reason: 'SELF_MESSAGE_SKIPPED'
        }
      })
      expect(response.body.moderation).toMatchObject({
        agent: 'evo-moderation',
        action: 'IGNORE',
        reason: 'SELF_MESSAGE_SKIPPED',
        stage: 'timeout',
        workflow: {
          banSkipped: true,
          timeoutSkipped: true,
          timeoutReason: 'SELF_MESSAGE_SKIPPED'
        }
      })
      expect(qnaModelDecide).not.toHaveBeenCalled()
      expect(banDecide).not.toHaveBeenCalled()
      expect(timeoutDecide).not.toHaveBeenCalled()
    })

    it('includes matched command details when the message matches a stored trigger', async () => {
      const app = createTestApp()
      const channelId = uniqueTestId('ch')

      await request(app)
        .post('/api/chat-commands')
        .send({
          channelId,
          trigger: '!linktree',
          replyText: 'You can reach me at https://linktr.ee/mylink'
        })
        .expect(201)

      const { app: ingestionApp } = createChatIngestionTestApp()
      const response = await request(ingestionApp)
        .post('/api/chat/ingest')
        .send({
          channelId,
          messageId: uniqueTestId('msg'),
          authorExternalId: uniqueTestId('author'),
          channelExternalId: uniqueTestId('ext-ch'),
          platform: 'youtube',
          sentAt: new Date().toISOString(),
          text: '  !LinkTree '
        })
        .expect(201)

      expect(response.body.command).toMatchObject({
        matched: true,
        replyText: 'You can reach me at https://linktr.ee/mylink'
      })
      expect(response.body.command.command).toMatchObject({
        channelId,
        trigger: '!linktree',
        enabled: true
      })
      expect(response.body.command.command).not.toHaveProperty('normalizedTrigger')
    })
  })

  // ─── POST /api/chat/ingest duplicate ──────────────────────────────────

  describe('duplicate ingest', () => {
    it('returns 200 with duplicate: true and does not rerun workflows', async () => {
      const { app, qnaModelDecide } = createChatIngestionTestApp({
        qnaDecide: () => ({
          question: '',
          response: ''
        })
      })

      const payload = {
        channelId: uniqueTestId('ch'),
        messageId: uniqueTestId('msg'),
        authorExternalId: uniqueTestId('author'),
        channelExternalId: uniqueTestId('ext-ch'),
        platform: 'twitch' as const,
        sentAt: new Date().toISOString(),
        text: 'What is the streaming schedule?'
      }

      // First ingest
      const firstResponse = await request(app)
        .post('/api/chat/ingest')
        .send(payload)
        .expect(201)

      expect(firstResponse.body.duplicate).toBe(false)

      const qnaCallCount = qnaModelDecide.mock.calls.length

      // Second ingest with same messageId and platform
      const secondResponse = await request(app)
        .post('/api/chat/ingest')
        .send({ ...payload, text: 'Different text that should be ignored' })
        .expect(200)

      expect(secondResponse.body.duplicate).toBe(true)

      // Should return the original stored text, not the new one
      expect(secondResponse.body.event.text).toBe(payload.text)

      // Q&A workflow should NOT have been called again
      expect(qnaModelDecide).toHaveBeenCalledTimes(qnaCallCount)
    })

    it('detects duplicate by platform + messageId combination', async () => {
      const { app } = createChatIngestionTestApp()

      const payload = {
        channelId: uniqueTestId('ch'),
        messageId: uniqueTestId('msg'),
        authorExternalId: uniqueTestId('author'),
        channelExternalId: uniqueTestId('ext-ch'),
        platform: 'kick' as const,
        sentAt: new Date().toISOString(),
        text: 'First text'
      }

      await request(app)
        .post('/api/chat/ingest')
        .send(payload)
        .expect(201)

      // Same messageId and platform → duplicate
      const secondResponse = await request(app)
        .post('/api/chat/ingest')
        .send({
          ...payload,
          channelId: uniqueTestId('ch-different'),
          text: 'Completely different text'
        })
        .expect(200)

      expect(secondResponse.body.duplicate).toBe(true)
      expect(secondResponse.body.event.text).toBe('First text')
      expect(secondResponse.body.event.platform).toBe('kick')
    })
  })

  // ─── Q&A response shape ───────────────────────────────────────────────

  describe('Q&A response shape', () => {
    it('includes answer and entry when Q&A agent matches', async () => {
      const channelId = uniqueTestId('ch')

      // Create a Q&A entry first so the workflow has an entry to match against
      const setupApp = createTestApp()
      const created = await request(setupApp)
        .post('/api/qna')
        .send({
          channelId,
          question: 'What is the streaming schedule?',
          answer: 'Every weekday at 3 PM EST'
        })
        .expect(201)

      // Create app with fake Q&A agent that returns SEND_ANSWER
      const { app } = createChatIngestionTestApp({
        qnaDecide: () => ({
          question: 'what is the streaming schedule',
          response: 'Every weekday at 3 PM EST'
        })
      })

      const payload = {
        channelId,
        messageId: uniqueTestId('msg'),
        authorExternalId: uniqueTestId('author'),
        channelExternalId: uniqueTestId('ext-ch'),
        platform: 'youtube' as const,
        sentAt: new Date().toISOString(),
        text: 'What is the streaming schedule?'
      }

      const response = await request(app)
        .post('/api/chat/ingest')
        .send(payload)
        .expect(201)

      // Verify Q&A matched shape
      expect(response.body.qna).toMatchObject({
        agent: 'qna',
        matched: true,
        action: 'SEND_ANSWER'
      })
      expect(response.body.qna.answer).toBe('Every weekday at 3 PM EST')
      expect(response.body.qna.entry).toMatchObject({
        id: created.body.id,
        question: 'What is the streaming schedule?'
      })
      expect(response.body.qna.entry).not.toHaveProperty('_id')
      expect(response.body.qna.entry).not.toHaveProperty('__v')
      expect(response.body.qna.workflow).toBeDefined()
    })

    it('omits answer and entry when Q&A agent finds no match', async () => {
      const { app } = createChatIngestionTestApp({
        qnaDecide: () => ({
          question: '',
          response: ''
        })
      })

      const payload = {
        channelId: uniqueTestId('ch'),
        messageId: uniqueTestId('msg'),
        authorExternalId: uniqueTestId('author'),
        channelExternalId: uniqueTestId('ext-ch'),
        platform: 'youtube' as const,
        sentAt: new Date().toISOString(),
        text: 'Who are you?'
      }

      const response = await request(app)
        .post('/api/chat/ingest')
        .send(payload)
        .expect(201)

      expect(response.body.qna).toMatchObject({
        agent: 'qna',
        matched: false,
        action: 'DO_NOTHING'
      })
      expect(response.body.qna).not.toHaveProperty('answer')
      expect(response.body.qna).not.toHaveProperty('entry')
      expect(response.body.qna.workflow).toBeDefined()
    })
  })

  // ─── Moderation response shape ────────────────────────────────────────

  describe('moderation response shape', () => {
    it('includes agent, action, catalogId, stage, and workflow for IGNORE with no categories', async () => {
      const { app } = createChatIngestionTestApp()

      const payload = {
        channelId: uniqueTestId('ch'),
        messageId: uniqueTestId('msg'),
        authorExternalId: uniqueTestId('author'),
        channelExternalId: uniqueTestId('ext-ch'),
        platform: 'youtube' as const,
        sentAt: new Date().toISOString(),
        text: 'Love the energy today'
      }

      const response = await request(app)
        .post('/api/chat/ingest')
        .send(payload)
        .expect(201)

      expect(response.body.moderation).toMatchObject({
        agent: 'evo-moderation',
        action: 'IGNORE',
        catalogId: null,
        stage: 'timeout'
      })
      expect(response.body.moderation.workflow).toMatchObject({
        receivedMessage: true,
        banSkipped: true,
        timeoutSkipped: true
      })
    })

    it('includes correct moderation shape when ban category is enabled and model returns BAN', async () => {
      const { app, banDecide, timeoutDecide } = createChatIngestionTestApp({
        moderationBanDecide: () => ({
          action: 'BAN' as const,
          categoryId: 'SCAM',
          reason: 'Phishing detected'
        })
      })

      const channelId = uniqueTestId('ch')
      await createCategory(app, {
        channelId,
        catalogId: 'SCAM',
        type: 'ban',
        label: 'Scam',
        definition: 'Scam or phishing'
      })

      const payload = {
        channelId,
        messageId: uniqueTestId('msg'),
        authorExternalId: uniqueTestId('author'),
        channelExternalId: uniqueTestId('ext-ch'),
        platform: 'twitch' as const,
        sentAt: new Date().toISOString(),
        text: 'Free giveaway at scam.example.com'
      }

      const response = await request(app)
        .post('/api/chat/ingest')
        .send(payload)
        .expect(201)

      expect(response.body.moderation).toMatchObject({
        agent: 'evo-moderation',
        action: 'BAN',
        catalogId: 'SCAM',
        stage: 'ban'
      })
      expect(response.body.moderation.workflow).toMatchObject({
        receivedMessage: true,
        banAction: 'BAN',
        timeoutSkipped: true,
        timeoutAction: null
      })
      expect(banDecide).toHaveBeenCalledTimes(1)
      // Timeout should NOT be called because BAN short-circuits
      expect(timeoutDecide).not.toHaveBeenCalled()
    })

    it('includes correct moderation shape when ban ignores and timeout triggers', async () => {
      const { app, banDecide, timeoutDecide } = createChatIngestionTestApp({
        moderationBanDecide: () => ({
          action: 'IGNORE' as const,
          categoryId: null,
          reason: 'No ban violation'
        }),
        moderationTimeoutDecide: () => ({
          action: 'TIMEOUT' as const,
          categoryId: 'INSULT',
          reason: 'Direct name-calling'
        })
      })

      const channelId = uniqueTestId('ch')
      await createCategory(app, {
        channelId,
        catalogId: 'SCAM',
        type: 'ban',
        label: 'Scam',
        definition: 'Scam or phishing'
      })
      await createCategory(app, {
        channelId,
        catalogId: 'INSULT',
        type: 'timeout',
        label: 'Insult',
        definition: 'Direct insults, name-calling'
      })

      const payload = {
        channelId,
        messageId: uniqueTestId('msg'),
        authorExternalId: uniqueTestId('author'),
        channelExternalId: uniqueTestId('ext-ch'),
        platform: 'kick' as const,
        sentAt: new Date().toISOString(),
        text: "You're an idiot"
      }

      const response = await request(app)
        .post('/api/chat/ingest')
        .send(payload)
        .expect(201)

      expect(response.body.moderation).toMatchObject({
        agent: 'evo-moderation',
        action: 'TIMEOUT',
        catalogId: 'INSULT',
        stage: 'timeout'
      })
      expect(response.body.moderation.workflow).toMatchObject({
        banAction: 'IGNORE',
        timeoutAction: 'TIMEOUT',
        banSkipped: false,
        timeoutSkipped: false
      })
      expect(banDecide).toHaveBeenCalledTimes(1)
      expect(timeoutDecide).toHaveBeenCalledTimes(1)
    })
  })
})
