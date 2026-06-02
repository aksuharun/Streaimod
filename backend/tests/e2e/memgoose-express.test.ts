import { type Express } from 'express'
import { Schema, model } from 'mongoose'
import request from 'supertest'

import { buildTestChatMessage } from '../helpers/factories.js'
import {
  clearTestDatabase,
  registerTestModel
} from '../helpers/test-database.js'
import { createTestApp } from '../helpers/test-app.js'

type HarnessMessage = {
  authorExternalId: string
  channelExternalId: string
  platform: 'youtube' | 'twitch' | 'kick'
  sentAt: string
  text: string
}

const harnessMessageSchema = new Schema<HarnessMessage>(
  {
    authorExternalId: { type: String, required: true },
    channelExternalId: { type: String, required: true },
    platform: { type: String, required: true },
    sentAt: { type: String, required: true },
    text: { type: String, required: true }
  },
  { timestamps: true }
)

const HarnessMessage = model<HarnessMessage>(
  'HarnessMessage',
  harnessMessageSchema
)

function configureHarnessMessages(app: Express): void {
  app.post('/harness/messages', async (request_, response, next) => {
    try {
      const body = request_.body as Partial<HarnessMessage>

      if (!body.authorExternalId || !body.text) {
        response.status(400).json({ error: 'authorExternalId and text are required' })
        return
      }

      const message = await HarnessMessage.create(body)

      response.status(201).json({
        authorExternalId: message.authorExternalId,
        id: message._id.toString(),
        text: message.text
      })
    } catch (error) {
      next(error)
    }
  })
}

describe('memgoose-backed Express tests', () => {
  beforeAll(() => {
    registerTestModel(HarnessMessage)
  })

  beforeEach(async () => {
    await clearTestDatabase()
  })

  it('persists request data in the in-memory database', async () => {
    const app = createTestApp(configureHarnessMessages)

    const messageInput = buildTestChatMessage({ text: 'Can I ask a question?' })

    const response = await request(app)
      .post('/harness/messages')
      .send(messageInput)
      .expect(201)

    expect(response.body).toMatchObject({
      authorExternalId: messageInput.authorExternalId,
      text: messageInput.text
    })

    const persisted = await HarnessMessage.findOne({
      authorExternalId: messageInput.authorExternalId
    })

    expect(persisted?.text).toBe(messageInput.text)
  })

  it('starts each test with an empty database', async () => {
    await expect(HarnessMessage.countDocuments({})).resolves.toBe(0)
  })

  it('rejects invalid requests without persisting documents', async () => {
    const app = createTestApp(configureHarnessMessages)

    const response = await request(app)
      .post('/harness/messages')
      .send({ text: 'Missing author' })
      .expect(400)

    expect(response.body).toEqual({ error: 'authorExternalId and text are required' })
    await expect(HarnessMessage.countDocuments({})).resolves.toBe(0)
  })
})
