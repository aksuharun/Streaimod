import request from 'supertest'

const authState = vi.hoisted(() => ({
  currentUser: {
    _id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
    picture: null,
    channels: [
      {
        channelId: 'channel-1',
        name: 'Test Channel',
        handle: null,
        thumbnail: null,
        qnaEnabled: true,
        commandsEnabled: true,
        moderationEnabled: false
      }
    ],
    activeChannelId: 'channel-1',
    save: vi.fn(async () => undefined)
  },
  hasEnabledModerationCategories: vi.fn(async () => false)
}))

vi.mock('../../src/middleware/auth.js', () => ({
  requireAuthenticatedUser: (request_: Record<string, unknown>, _response: unknown, next: () => void) => {
    request_.authUser = authState.currentUser
    next()
  },
  getAuthenticatedUser: () => authState.currentUser,
  resolveOwnedChannelId: (
    _request: unknown,
    _response: unknown,
    input: unknown,
    options: { fallbackToActiveChannel?: boolean } = {}
  ) => {
    if (typeof input === 'string' && input.trim().length > 0) {
      return input.trim()
    }

    return options.fallbackToActiveChannel
      ? authState.currentUser.activeChannelId
      : null
  }
}))

vi.mock('../../src/services/moderation-category-service.js', () => ({
  hasEnabledModerationCategories: authState.hasEnabledModerationCategories
}))

import { createTestApp } from '../helpers/test-app.js'

describe('auth channel settings routes', () => {
  beforeEach(() => {
    authState.currentUser.channels = [
      {
        channelId: 'channel-1',
        name: 'Test Channel',
        handle: null,
        thumbnail: null,
        qnaEnabled: true,
        commandsEnabled: true,
        moderationEnabled: false
      }
    ]
    authState.currentUser.activeChannelId = 'channel-1'
    authState.currentUser.save.mockClear()
    authState.hasEnabledModerationCategories.mockReset()
    authState.hasEnabledModerationCategories.mockResolvedValue(false)
  })

  it('rejects enabling moderation when the channel has no enabled moderation categories', async () => {
    const app = createTestApp()

    const response = await request(app)
      .patch('/api/auth/channels/channel-1/settings')
      .send({ moderationEnabled: true })
      .expect(409)

    expect(authState.hasEnabledModerationCategories).toHaveBeenCalledWith('channel-1')
    expect(authState.currentUser.save).not.toHaveBeenCalled()
    expect(response.body).toEqual({
      error:
        'Enable at least one moderation category before enabling the moderation agent'
    })
    expect(authState.currentUser.channels[0]?.moderationEnabled).toBe(false)
  })

  it('allows enabling moderation when the channel has an enabled moderation category', async () => {
    authState.hasEnabledModerationCategories.mockResolvedValue(true)
    const app = createTestApp()

    const response = await request(app)
      .patch('/api/auth/channels/channel-1/settings')
      .send({ moderationEnabled: true })
      .expect(200)

    expect(authState.hasEnabledModerationCategories).toHaveBeenCalledWith('channel-1')
    expect(authState.currentUser.save).toHaveBeenCalledTimes(1)
    expect(response.body.user.channels[0]).toMatchObject({
      channelId: 'channel-1',
      moderationEnabled: true
    })
    expect(authState.currentUser.channels[0]?.moderationEnabled).toBe(true)
  })
})
