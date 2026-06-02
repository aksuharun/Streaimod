import request from 'supertest'

import { ChatCommand } from '../../src/models/chat-command.js'
import { uniqueTestId } from '../helpers/factories.js'
import { createTestApp } from '../helpers/test-app.js'
import {
  clearTestDatabase,
  registerTestModel
} from '../helpers/test-database.js'

describe('Chat Command API', () => {
  beforeAll(() => {
    registerTestModel(ChatCommand)
  })

  beforeEach(async () => {
    await clearTestDatabase()
  })

  it('creates a chat command and hides internal fields', async () => {
    const app = createTestApp()
    const payload = {
      channelId: uniqueTestId('ch'),
      trigger: '!linktree',
      replyText: 'You can reach me at https://linktr.ee/mylink'
    }

    const response = await request(app)
      .post('/api/chat-commands')
      .send(payload)
      .expect(201)

    expect(response.body).toMatchObject({
      channelId: payload.channelId,
      trigger: payload.trigger,
      replyText: payload.replyText,
      enabled: true
    })
    expect(response.body.id).toBeDefined()
    expect(response.body).not.toHaveProperty('_id')
    expect(response.body).not.toHaveProperty('__v')
    expect(response.body).not.toHaveProperty('normalizedTrigger')
  })

  it('returns 400 when trigger is missing', async () => {
    const app = createTestApp()

    const response = await request(app)
      .post('/api/chat-commands')
      .send({
        channelId: uniqueTestId('ch'),
        replyText: 'https://linktr.ee/mylink'
      })
      .expect(400)

    expect(response.body.error).toMatch(/trigger/)
  })

  it('returns 400 when trigger does not start with !', async () => {
    const app = createTestApp()

    const response = await request(app)
      .post('/api/chat-commands')
      .send({
        channelId: uniqueTestId('ch'),
        trigger: 'linktree',
        replyText: 'https://linktr.ee/mylink'
      })
      .expect(400)

    expect(response.body.error).toMatch(/start with !/)
  })

  it('returns 409 for duplicate triggers in the same channel', async () => {
    const app = createTestApp()
    const channelId = uniqueTestId('ch')

    await request(app)
      .post('/api/chat-commands')
      .send({
        channelId,
        trigger: '!LinkTree',
        replyText: 'first'
      })
      .expect(201)

    const response = await request(app)
      .post('/api/chat-commands')
      .send({
        channelId,
        trigger: '!linktree',
        replyText: 'second'
      })
      .expect(409)

    expect(response.body.error).toMatch(/already exists/)
  })

  it('lists commands filtered by channelId', async () => {
    const app = createTestApp()
    const channelId = uniqueTestId('ch')

    await request(app)
      .post('/api/chat-commands')
      .send({ channelId, trigger: '!first', replyText: 'First' })
      .expect(201)
    await request(app)
      .post('/api/chat-commands')
      .send({ channelId, trigger: '!second', replyText: 'Second' })
      .expect(201)

    const response = await request(app)
      .get('/api/chat-commands')
      .query({ channelId })
      .expect(200)

    expect(response.body).toHaveLength(2)
    expect(response.body[0].trigger).toBe('!second')
    expect(response.body[1].trigger).toBe('!first')
  })

  it('updates a chat command', async () => {
    const app = createTestApp()
    const created = await request(app)
      .post('/api/chat-commands')
      .send({
        channelId: uniqueTestId('ch'),
        trigger: '!linktree',
        replyText: 'old reply'
      })
      .expect(201)

    const response = await request(app)
      .patch(`/api/chat-commands/${created.body.id}`)
      .send({
        trigger: '!socials',
        replyText: 'new reply',
        enabled: false
      })
      .expect(200)

    expect(response.body).toMatchObject({
      trigger: '!socials',
      replyText: 'new reply',
      enabled: false
    })
  })

  it('deletes a chat command', async () => {
    const app = createTestApp()
    const created = await request(app)
      .post('/api/chat-commands')
      .send({
        channelId: uniqueTestId('ch'),
        trigger: '!linktree',
        replyText: 'delete me'
      })
      .expect(201)

    await request(app)
      .delete(`/api/chat-commands/${created.body.id}`)
      .expect(204)

    await request(app)
      .get(`/api/chat-commands/${created.body.id}`)
      .expect(404)
  })
})
