import request from 'supertest'

import { QnaEntry } from '../../src/models/qna-entry.js'
import { setQnaAgentDependencies } from '../../src/routes/qna-routes.js'
import type {
  QnaAgentDependencies,
  QnaAgentModelDecision,
  QnaAgentModelInput,
  QnaPromptVariables
} from '../../src/services/qna-agent-service.js'
import { uniqueTestId } from '../helpers/factories.js'
import { createTestApp } from '../helpers/test-app.js'
import {
  clearTestDatabase,
  registerTestModel
} from '../helpers/test-database.js'

function createQnaMatchTestApp(
  decide: (
    input: QnaAgentModelInput
  ) => QnaAgentModelDecision | Promise<QnaAgentModelDecision>
) {
  const render = vi.fn(async (_variables: QnaPromptVariables) => 'rendered qna prompt')
  const modelDecide = vi.fn(async (input: QnaAgentModelInput) => decide(input))
  const dependencies: QnaAgentDependencies = {
    promptRenderer: { render },
    model: { decide: modelDecide }
  }
  const app = createTestApp((expressApp) => {
    setQnaAgentDependencies(expressApp, dependencies)
  })

  return { app, render, modelDecide }
}

describe('Q&A API', () => {
  beforeAll(() => {
    registerTestModel(QnaEntry)
  })

  beforeEach(async () => {
    await clearTestDatabase()
  })

  // ─── POST /api/qna (create) ───────────────────────────────────────

  describe('POST /api/qna', () => {
    it('creates a Q&A entry and returns 201 with the entry JSON', async () => {
      const app = createTestApp()
      const payload = {
        channelId: uniqueTestId('ch'),
        question: 'What is the schedule?',
        answer: 'Every weekday at 3 PM EST'
      }

      const response = await request(app)
        .post('/api/qna')
        .send(payload)
        .expect(201)

      expect(response.body).toMatchObject({
        channelId: payload.channelId,
        question: payload.question,
        answer: payload.answer,
        enabled: true
      })
      expect(response.body.normalizedQuestion).toBe(
        'what is the schedule'
      )
      expect(response.body.id).toBeDefined()
      expect(response.body.createdAt).toBeDefined()
      expect(response.body.updatedAt).toBeDefined()
      expect(response.body).not.toHaveProperty('_id')
      expect(response.body).not.toHaveProperty('__v')
    })

    it('returns 400 when channelId is missing', async () => {
      const app = createTestApp()
      const payload = {
        question: 'What is the schedule?',
        answer: 'Every weekday at 3 PM EST'
      }

      const response = await request(app)
        .post('/api/qna')
        .send(payload)
        .expect(400)

      expect(response.body.error).toMatch(/channelId/)
    })

    it('returns 400 when question is missing', async () => {
      const app = createTestApp()
      const payload = {
        channelId: uniqueTestId('ch'),
        answer: 'Every weekday at 3 PM EST'
      }

      const response = await request(app)
        .post('/api/qna')
        .send(payload)
        .expect(400)

      expect(response.body.error).toMatch(/question/)
    })

    it('returns 400 when answer is missing', async () => {
      const app = createTestApp()
      const payload = {
        channelId: uniqueTestId('ch'),
        question: 'What is the schedule?'
      }

      const response = await request(app)
        .post('/api/qna')
        .send(payload)
        .expect(400)

      expect(response.body.error).toMatch(/answer/)
    })

    it('returns 400 when required fields are empty strings', async () => {
      const app = createTestApp()
      const payload = {
        channelId: '  ',
        question: 'What is the schedule?',
        answer: 'Every weekday at 3 PM EST'
      }

      const response = await request(app)
        .post('/api/qna')
        .send(payload)
        .expect(400)

      expect(response.body.error).toMatch(/channelId/)
    })

    it('returns 400 when question normalizes to empty', async () => {
      const app = createTestApp()

      const response = await request(app)
        .post('/api/qna')
        .send({
          channelId: uniqueTestId('ch'),
          question: '???',
          answer: 'An answer'
        })
        .expect(400)

      expect(response.body.error).toMatch(/empty/)
    })

    it('returns 409 when creating a duplicate question in the same channel', async () => {
      const app = createTestApp()
      const channelId = uniqueTestId('ch')
      const payload = {
        channelId,
        question: 'What is the schedule?',
        answer: 'Every weekday at 3 PM EST'
      }

      await request(app)
        .post('/api/qna')
        .send(payload)
        .expect(201)

      const response = await request(app)
        .post('/api/qna')
        .send({ ...payload, answer: 'Different answer' })
        .expect(409)

      expect(response.body.error).toMatch(/already exists/)
    })

    it('allows the same normalized question in a different channel', async () => {
      const app = createTestApp()
      const channelA = uniqueTestId('ch-a')
      const channelB = uniqueTestId('ch-b')

      await request(app)
        .post('/api/qna')
        .send({
          channelId: channelA,
          question: 'What is the schedule?',
          answer: 'Answer A'
        })
        .expect(201)

      const response = await request(app)
        .post('/api/qna')
        .send({
          channelId: channelB,
          question: 'What is the schedule?',
          answer: 'Answer B'
        })
        .expect(201)

      expect(response.body.id).toBeDefined()
      expect(response.body.channelId).toBe(channelB)
    })

    it('trims channelId before storing', async () => {
      const app = createTestApp()

      const response = await request(app)
        .post('/api/qna')
        .send({
          channelId: '  ch-trimmed  ',
          question: 'What is the schedule?',
          answer: 'Every weekday at 3 PM EST'
        })
        .expect(201)

      expect(response.body.channelId).toBe('ch-trimmed')
    })
  })

  // ─── GET /api/qna (list) ─────────────────────────────────────────

  describe('GET /api/qna', () => {
    it('lists all Q&A entries ordered by newest first and never exposes _id or __v', async () => {
      const app = createTestApp()
      const channelId = uniqueTestId('ch')

      await request(app)
        .post('/api/qna')
        .send({ channelId, question: 'First Q', answer: 'First A' })

      await request(app)
        .post('/api/qna')
        .send({ channelId, question: 'Second Q', answer: 'Second A' })

      const response = await request(app)
        .get('/api/qna')
        .expect(200)

      expect(response.body).toHaveLength(2)
      expect(response.body[0].question).toBe('Second Q')
      expect(response.body[1].question).toBe('First Q')
      for (const entry of response.body) {
        expect(entry).toHaveProperty('id')
        expect(entry).not.toHaveProperty('_id')
        expect(entry).not.toHaveProperty('__v')
      }
    })

    it('filters entries by channelId when provided', async () => {
      const app = createTestApp()
      const channelA = uniqueTestId('ch-a')
      const channelB = uniqueTestId('ch-b')

      await request(app)
        .post('/api/qna')
        .send({ channelId: channelA, question: 'A Q', answer: 'A A' })

      await request(app)
        .post('/api/qna')
        .send({ channelId: channelB, question: 'B Q', answer: 'B A' })

      const response = await request(app)
        .get(`/api/qna?channelId=${encodeURIComponent(channelA)}`)
        .expect(200)

      expect(response.body).toHaveLength(1)
      expect(response.body[0].channelId).toBe(channelA)
    })

    it('returns an empty array when no entries exist', async () => {
      const app = createTestApp()

      const response = await request(app)
        .get('/api/qna')
        .expect(200)

      expect(response.body).toEqual([])
    })

    it('trims channelId query parameter', async () => {
      const app = createTestApp()
      const channelId = uniqueTestId('ch')

      await request(app)
        .post('/api/qna')
        .send({ channelId, question: 'A Q', answer: 'A A' })

      const response = await request(app)
        .get(`/api/qna?channelId=${encodeURIComponent('  ' + channelId + '  ')}`)
        .expect(200)

      expect(response.body).toHaveLength(1)
    })
  })

  describe('POST /api/qna/bulk-import', () => {
    it('creates and updates entries from a versioned payload', async () => {
      const app = createTestApp()
      const channelId = uniqueTestId('ch')

      await request(app)
        .post('/api/qna')
        .send({
          channelId,
          question: 'What is the schedule?',
          answer: 'Old answer',
          enabled: true
        })
        .expect(201)

      const response = await request(app)
        .post('/api/qna/bulk-import')
        .send({
          channelId,
          version: 1,
          entries: [
            {
              question: 'WHAT IS THE SCHEDULE??',
              answer: 'New answer',
              enabled: false
            },
            {
              question: 'Where is the Discord link?',
              answer: 'In the description.'
            }
          ]
        })
        .expect(200)

      expect(response.body).toMatchObject({
        createdCount: 1,
        updatedCount: 1,
        unchangedCount: 0,
        totalCount: 2
      })
      expect(response.body.entries).toHaveLength(2)

      const listResponse = await request(app)
        .get(`/api/qna?channelId=${encodeURIComponent(channelId)}`)
        .expect(200)

      expect(listResponse.body).toHaveLength(2)
      expect(listResponse.body[0]).toMatchObject({
        question: 'Where is the Discord link?',
        answer: 'In the description.',
        enabled: true
      })
      expect(listResponse.body[1]).toMatchObject({
        question: 'WHAT IS THE SCHEDULE??',
        answer: 'New answer',
        enabled: false,
        normalizedQuestion: 'what is the schedule'
      })
    })

    it('returns 400 for duplicated normalized questions inside the payload', async () => {
      const app = createTestApp()
      const response = await request(app)
        .post('/api/qna/bulk-import')
        .send({
          channelId: uniqueTestId('ch'),
          version: 1,
          entries: [
            {
              question: 'Yasin kaç?',
              answer: '22'
            },
            {
              question: 'Yasin kac?',
              answer: '22'
            }
          ]
        })
        .expect(400)

      expect(response.body.error).toMatch(/same normalized question/)
    })

    it('returns 400 when the payload contains unsupported top-level keys', async () => {
      const app = createTestApp()
      const response = await request(app)
        .post('/api/qna/bulk-import')
        .send({
          channelId: uniqueTestId('ch'),
          version: 1,
          entries: [
            {
              question: 'What is the schedule?',
              answer: 'Weekdays at 3 PM EST'
            }
          ],
          replaceAll: true
        })
        .expect(400)

      expect(response.body.error).toMatch(/Only channelId, version, and entries/)
    })

    it('returns 400 when an entry contains unsupported keys', async () => {
      const app = createTestApp()
      const response = await request(app)
        .post('/api/qna/bulk-import')
        .send({
          channelId: uniqueTestId('ch'),
          version: 1,
          entries: [
            {
              question: 'What is the schedule?',
              answer: 'Weekdays at 3 PM EST',
              normalizedQuestion: 'what is the schedule'
            }
          ]
        })
        .expect(400)

      expect(response.body.error).toMatch(/may only include question, answer, and enabled/)
    })
  })

  // ─── GET /api/qna/:id (single) ───────────────────────────────────

  describe('GET /api/qna/:id', () => {
    it('returns a single entry by ID with id not _id', async () => {
      const app = createTestApp()
      const payload = {
        channelId: uniqueTestId('ch'),
        question: 'What is the schedule?',
        answer: 'Every weekday at 3 PM EST'
      }

      const created = await request(app)
        .post('/api/qna')
        .send(payload)
        .expect(201)

      const response = await request(app)
        .get(`/api/qna/${created.body.id}`)
        .expect(200)

      expect(response.body.id).toBe(created.body.id)
      expect(response.body.question).toBe(payload.question)
      expect(response.body).not.toHaveProperty('_id')
      expect(response.body).not.toHaveProperty('__v')
    })

    it('returns 404 for a non-existent ID', async () => {
      const app = createTestApp()

      const response = await request(app)
        .get('/api/qna/507f1f77bcf86cd799439011')
        .expect(404)

      expect(response.body).toEqual({ error: 'Q&A entry not found' })
    })

    it('returns 404 for an invalid ObjectId format', async () => {
      const app = createTestApp()

      const response = await request(app)
        .get('/api/qna/not-a-valid-id')
        .expect(404)

      expect(response.body).toEqual({ error: 'Q&A entry not found' })
    })
  })

  // ─── PATCH /api/qna/:id (update) ─────────────────────────────────

  describe('PATCH /api/qna/:id', () => {
    it('updates question and recomputes normalizedQuestion', async () => {
      const app = createTestApp()
      const created = await request(app)
        .post('/api/qna')
        .send({
          channelId: uniqueTestId('ch'),
          question: 'Old question?',
          answer: 'Some answer'
        })
        .expect(201)

      const response = await request(app)
        .patch(`/api/qna/${created.body.id}`)
        .send({ question: '  New question??  ' })
        .expect(200)

      expect(response.body.question).toBe('New question??')
      expect(response.body.normalizedQuestion).toBe('new question')
      expect(response.body.answer).toBe('Some answer')
    })

    it('updates answer without changing question', async () => {
      const app = createTestApp()
      const created = await request(app)
        .post('/api/qna')
        .send({
          channelId: uniqueTestId('ch'),
          question: 'Q?',
          answer: 'Old answer'
        })
        .expect(201)

      const response = await request(app)
        .patch(`/api/qna/${created.body.id}`)
        .send({ answer: 'New answer' })
        .expect(200)

      expect(response.body.answer).toBe('New answer')
      expect(response.body.question).toBe('Q?')
      expect(response.body.normalizedQuestion).toBe('q')
    })

    it('updates enabled flag', async () => {
      const app = createTestApp()
      const created = await request(app)
        .post('/api/qna')
        .send({
          channelId: uniqueTestId('ch'),
          question: 'Q?',
          answer: 'A'
        })
        .expect(201)

      const response = await request(app)
        .patch(`/api/qna/${created.body.id}`)
        .send({ enabled: false })
        .expect(200)

      expect(response.body.enabled).toBe(false)
    })

    it('returns 404 for a non-existent ID', async () => {
      const app = createTestApp()

      const response = await request(app)
        .patch('/api/qna/507f1f77bcf86cd799439011')
        .send({ question: 'Updated?' })
        .expect(404)

      expect(response.body).toEqual({ error: 'Q&A entry not found' })
    })

    it('returns 400 when no valid fields are provided', async () => {
      const app = createTestApp()
      const created = await request(app)
        .post('/api/qna')
        .send({
          channelId: uniqueTestId('ch'),
          question: 'Q?',
          answer: 'A'
        })
        .expect(201)

      const response = await request(app)
        .patch(`/api/qna/${created.body.id}`)
        .send({})
        .expect(400)

      expect(response.body.error).toMatch(/At least one/)
    })

    it('returns 400 when question is an empty string', async () => {
      const app = createTestApp()
      const created = await request(app)
        .post('/api/qna')
        .send({
          channelId: uniqueTestId('ch'),
          question: 'Q?',
          answer: 'A'
        })
        .expect(201)

      const response = await request(app)
        .patch(`/api/qna/${created.body.id}`)
        .send({ question: '  ' })
        .expect(400)

      expect(response.body.error).toMatch(/question/)
    })

    it('returns 400 when updated question normalizes to empty', async () => {
      const app = createTestApp()
      const created = await request(app)
        .post('/api/qna')
        .send({
          channelId: uniqueTestId('ch'),
          question: 'Original',
          answer: 'A'
        })
        .expect(201)

      const response = await request(app)
        .patch(`/api/qna/${created.body.id}`)
        .send({ question: '???' })
        .expect(400)

      expect(response.body.error).toMatch(/empty/)
    })

    it('returns 409 when updating to a question that already exists in the same channel', async () => {
      const app = createTestApp()
      const channelId = uniqueTestId('ch')

      const first = await request(app)
        .post('/api/qna')
        .send({ channelId, question: 'First Q?', answer: 'First A' })
        .expect(201)

      const second = await request(app)
        .post('/api/qna')
        .send({ channelId, question: 'Second Q?', answer: 'Second A' })
        .expect(201)

      const response = await request(app)
        .patch(`/api/qna/${second.body.id}`)
        .send({ question: 'First Q?' })
        .expect(409)

      expect(response.body.error).toMatch(/already exists/)
    })

    it('allows updating an entry to its own unchanged normalized question', async () => {
      const app = createTestApp()
      const channelId = uniqueTestId('ch')

      const created = await request(app)
        .post('/api/qna')
        .send({ channelId, question: 'Hello?', answer: 'Hi' })
        .expect(201)

      const response = await request(app)
        .patch(`/api/qna/${created.body.id}`)
        .send({ question: '  Hello?  ' })
        .expect(200)

      expect(response.body.normalizedQuestion).toBe('hello')
    })
  })

  // ─── DELETE /api/qna/:id ─────────────────────────────────────────

  describe('DELETE /api/qna/:id', () => {
    it('deletes an entry and returns 204', async () => {
      const app = createTestApp()
      const created = await request(app)
        .post('/api/qna')
        .send({
          channelId: uniqueTestId('ch'),
          question: 'Q?',
          answer: 'A'
        })
        .expect(201)

      await request(app)
        .delete(`/api/qna/${created.body.id}`)
        .expect(204)

      // Verify it's actually gone
      await request(app)
        .get(`/api/qna/${created.body.id}`)
        .expect(404)
    })

    it('returns 404 for a non-existent ID', async () => {
      const app = createTestApp()

      const response = await request(app)
        .delete('/api/qna/507f1f77bcf86cd799439011')
        .expect(404)

      expect(response.body).toEqual({ error: 'Q&A entry not found' })
    })
  })

  // ─── POST /api/qna/match ─────────────────────────────────────────

  describe('POST /api/qna/match', () => {
    it('returns SEND_ANSWER when the Q&A agent finds a database answer for a question', async () => {
      const { app } = createQnaMatchTestApp(() => ({
        question: 'what is the schedule',
        response: 'Every weekday at 3 PM EST'
      }))
      const channelId = uniqueTestId('ch')

      const created = await request(app)
        .post('/api/qna')
        .send({
          channelId,
          question: 'What is the schedule?',
          answer: 'Every weekday at 3 PM EST'
        })
        .expect(201)

      const response = await request(app)
        .post('/api/qna/match')
        .send({ channelId, messageText: ' what is THE schedule??! ' })
        .expect(200)

      expect(response.body).toMatchObject({
        agent: 'qna',
        matched: true,
        action: 'SEND_ANSWER',
        answer: 'Every weekday at 3 PM EST'
      })
      expect(response.body.entry).toMatchObject({
        id: created.body.id,
        question: 'What is the schedule?'
      })
      expect(response.body.workflow).toMatchObject({
        receivedMessage: true,
        retrievedEntries: 1,
        retrievedQnaEntries: [
          {
            id: created.body.id,
            question: 'What is the schedule?',
            answer: 'Every weekday at 3 PM EST'
          }
        ],
        normalizedMessage: 'what is the schedule',
        promptRendered: true,
        decision: 'SEND_ANSWER',
        reason: 'ANSWER_FOUND'
      })
      expect(response.body.entry).not.toHaveProperty('_id')
      expect(response.body.entry).not.toHaveProperty('__v')
    })

    it('returns DO_NOTHING when no database answer matches the question', async () => {
      const { app } = createQnaMatchTestApp(() => ({
        question: '',
        response: ''
      }))
      const channelId = uniqueTestId('ch')

      await request(app)
        .post('/api/qna')
        .send({
          channelId,
          question: 'What is the schedule?',
          answer: 'Every weekday at 3 PM EST'
        })
        .expect(201)

      const response = await request(app)
        .post('/api/qna/match')
        .send({ channelId, messageText: 'Who are you?' })
        .expect(200)

      expect(response.body).toMatchObject({
        agent: 'qna',
        matched: false,
        action: 'DO_NOTHING',
        workflow: {
          receivedMessage: true,
          retrievedEntries: 1,
          retrievedQnaEntries: [
            {
              question: 'What is the schedule?',
              answer: 'Every weekday at 3 PM EST'
            }
          ],
          normalizedMessage: 'who are you',
          promptRendered: true,
          decision: 'DO_NOTHING',
          reason: 'NO_DATABASE_MATCH'
        }
      })
      expect(response.body).not.toHaveProperty('answer')
      expect(response.body).not.toHaveProperty('entry')
    })

    it('runs the Q&A agent for statement-like messages and returns DO_NOTHING when the agent declines', async () => {
      const { app, modelDecide } = createQnaMatchTestApp(() => ({
        question: '',
        response: ''
      }))
      const channelId = uniqueTestId('ch')

      await request(app)
        .post('/api/qna')
        .send({
          channelId,
          question: 'Schedule',
          answer: 'Every weekday at 3 PM EST'
        })
        .expect(201)

      const response = await request(app)
        .post('/api/qna/match')
        .send({ channelId, messageText: 'schedule' })
        .expect(200)

      expect(response.body).toMatchObject({
        agent: 'qna',
        matched: false,
        action: 'DO_NOTHING',
        workflow: {
          retrievedEntries: 1,
          retrievedQnaEntries: [
            {
              question: 'Schedule',
              answer: 'Every weekday at 3 PM EST'
            }
          ],
          normalizedMessage: 'schedule',
          promptRendered: true,
          decision: 'DO_NOTHING',
          reason: 'NO_DATABASE_MATCH'
        }
      })
      expect(modelDecide).toHaveBeenCalledTimes(1)
      expect(response.body).not.toHaveProperty('answer')
      expect(response.body).not.toHaveProperty('entry')
    })

    it('returns DO_NOTHING for an enabled:false entry', async () => {
      const { app } = createQnaMatchTestApp(() => ({
        question: '',
        response: ''
      }))
      const channelId = uniqueTestId('ch')

      const created = await request(app)
        .post('/api/qna')
        .send({
          channelId,
          question: 'What is the schedule?',
          answer: 'Every weekday at 3 PM EST'
        })
        .expect(201)

      await request(app)
        .patch(`/api/qna/${created.body.id}`)
        .send({ enabled: false })
        .expect(200)

      const response = await request(app)
        .post('/api/qna/match')
        .send({ channelId, messageText: 'What is the schedule?' })
        .expect(200)

      expect(response.body).toMatchObject({
        matched: false,
        action: 'DO_NOTHING',
        workflow: {
          retrievedEntries: 0,
          retrievedQnaEntries: [],
          decision: 'DO_NOTHING',
          reason: 'NO_DATABASE_MATCH'
        }
      })
      expect(response.body).not.toHaveProperty('answer')
      expect(response.body).not.toHaveProperty('entry')
    })

    it('returns DO_NOTHING when channelId differs', async () => {
      const { app } = createQnaMatchTestApp(() => ({
        question: '',
        response: ''
      }))

      await request(app)
        .post('/api/qna')
        .send({
          channelId: uniqueTestId('ch-a'),
          question: 'What is the schedule?',
          answer: 'Every weekday at 3 PM EST'
        })
        .expect(201)

      const response = await request(app)
        .post('/api/qna/match')
        .send({
          channelId: uniqueTestId('ch-b'),
          messageText: 'What is the schedule?'
        })
        .expect(200)

      expect(response.body).toMatchObject({
        matched: false,
        action: 'DO_NOTHING',
        workflow: {
          retrievedEntries: 0,
          retrievedQnaEntries: [],
          decision: 'DO_NOTHING',
          reason: 'NO_DATABASE_MATCH'
        }
      })
      expect(response.body).not.toHaveProperty('answer')
      expect(response.body).not.toHaveProperty('entry')
    })

    it('returns 400 when channelId is missing', async () => {
      const { app } = createQnaMatchTestApp(() => ({
        question: '',
        response: ''
      }))

      const response = await request(app)
        .post('/api/qna/match')
        .send({ messageText: 'Hello?' })
        .expect(400)

      expect(response.body.error).toMatch(/channelId/)
    })

    it('returns 400 when messageText is missing', async () => {
      const { app } = createQnaMatchTestApp(() => ({
        question: '',
        response: ''
      }))

      const response = await request(app)
        .post('/api/qna/match')
        .send({ channelId: uniqueTestId('ch') })
        .expect(400)

      expect(response.body.error).toMatch(/messageText/)
    })

    it('trims channelId for matching', async () => {
      const { app } = createQnaMatchTestApp(() => ({
        question: 'what is the schedule',
        response: 'Every weekday at 3 PM EST'
      }))
      const channelId = 'ch-match-trim'

      await request(app)
        .post('/api/qna')
        .send({
          channelId,
          question: 'What is the schedule?',
          answer: 'Every weekday at 3 PM EST'
        })
        .expect(201)

      const response = await request(app)
        .post('/api/qna/match')
        .send({ channelId: '  ' + channelId + '  ', messageText: 'What is the schedule?' })
        .expect(200)

      expect(response.body.matched).toBe(true)
      expect(response.body.action).toBe('SEND_ANSWER')
    })
  })
})
