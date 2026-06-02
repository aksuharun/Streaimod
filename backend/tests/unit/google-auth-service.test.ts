const mocks = vi.hoisted(() => ({
  createYoutubeClient: vi.fn()
}))

vi.mock('unified-creator-metrics', async () => {
  const actual = await vi.importActual<typeof import('unified-creator-metrics')>(
    'unified-creator-metrics'
  )

  return {
    ...actual,
    createYoutubeClient: mocks.createYoutubeClient
  }
})

import { User } from '../../src/models/user.js'
import {
  authenticateGoogleUser,
  buildGoogleAuthorizationUrl,
  toAuthSessionDto
} from '../../src/services/google-auth-service.js'
import { encryptSecret } from '../../src/services/auth-crypto.js'
import { withTemporaryEnv } from '../helpers/env.js'
import {
  clearTestDatabase,
  registerTestModel
} from '../helpers/test-database.js'

const oauthEnv = {
  AUTH_TOKEN_ENCRYPTION_KEY: 'test-auth-token-encryption-key',
  YOUTUBE_CLIENT_ID: 'test-youtube-client-id',
  YOUTUBE_CLIENT_SECRET: 'test-youtube-client-secret',
  GOOGLE_REDIRECT_URI: 'http://localhost:5173/api/auth/google/callback'
}

function createFetcher({
  tokenResponse,
  profileResponse
}: {
  tokenResponse: Record<string, unknown>
  profileResponse: Record<string, unknown>
}) {
  return vi.fn(
    async (input: string | URL | Request, _init?: RequestInit): Promise<Response> => {
      const url = String(input instanceof Request ? input.url : input)

      if (url === 'https://oauth2.googleapis.com/token') {
        return new Response(JSON.stringify(tokenResponse), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }

      if (url === 'https://openidconnect.googleapis.com/v1/userinfo') {
        return new Response(JSON.stringify(profileResponse), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }

      throw new Error(`Unexpected fetch URL: ${url}`)
    }
  )
}

function createYoutubeClientMock(identityOverrides?: Partial<{
  channelId: string
  displayName: string
  handle: string
  profilePictureUrl: string
}>) {
  return {
    channels: {
      getAuthenticatedUser: vi.fn().mockResolvedValue({
        channelId: 'channel-1',
        displayName: 'Channel One',
        handle: '@channel-one',
        profilePictureUrl: 'https://img.youtube.test/channel-1.jpg',
        ...identityOverrides
      })
    }
  }
}

describe('authenticateGoogleUser', () => {
  beforeAll(() => {
    registerTestModel(User)
  })

  beforeEach(async () => {
    await clearTestDatabase()
    mocks.createYoutubeClient.mockReset()
  })

  it('stores the YouTube channel thumbnail on first login', async () => {
    const youtube = createYoutubeClientMock()
    mocks.createYoutubeClient.mockReturnValue(youtube)
    const fetcher = createFetcher({
      tokenResponse: {
        access_token: 'access-token-1',
        refresh_token: 'refresh-token-1',
        expires_in: 3600,
        scope: 'openid email profile https://www.googleapis.com/auth/youtube.readonly'
      },
      profileResponse: {
        sub: 'google-subject-1',
        email: 'creator@example.com',
        name: 'Creator One',
        picture: 'https://img.google.test/user-1.jpg'
      }
    })

    await withTemporaryEnv(oauthEnv, async () => {
      const user = await authenticateGoogleUser('oauth-code-1', fetcher)

      expect(mocks.createYoutubeClient).toHaveBeenCalledWith({
        accessToken: 'access-token-1'
      })
      expect(youtube.channels.getAuthenticatedUser).toHaveBeenCalledTimes(1)
      expect(user.channels).toEqual([
        expect.objectContaining({
          channelId: 'channel-1',
          name: 'Channel One',
          handle: '@channel-one',
          thumbnail: 'https://img.youtube.test/channel-1.jpg'
        })
      ])

      const storedUser = await User.findById(user._id).lean().exec()
      expect(storedUser?.channels).toEqual([
        expect.objectContaining({
          channelId: 'channel-1',
          name: 'Channel One',
          handle: '@channel-one',
          thumbnail: 'https://img.youtube.test/channel-1.jpg'
        })
      ])
      expect(toAuthSessionDto(user).user.channels[0]?.thumbnail).toBe(
        'https://img.youtube.test/channel-1.jpg'
      )
    })
  })

  it('reuses the stored channel thumbnail on repeat login without calling YouTube', async () => {
    const fetcher = createFetcher({
      tokenResponse: {
        access_token: 'access-token-2',
        expires_in: 3600,
        scope: 'openid email profile https://www.googleapis.com/auth/youtube.readonly'
      },
      profileResponse: {
        sub: 'google-subject-2',
        email: 'creator-two@example.com',
        name: 'Creator Two',
        picture: 'https://img.google.test/user-2.jpg'
      }
    })

    await withTemporaryEnv(oauthEnv, async () => {
      await User.create({
        googleSubject: 'google-subject-2',
        email: 'old@example.com',
        name: 'Old Name',
        picture: null,
        refreshToken: encryptSecret('stored-refresh-token'),
        activeChannelId: 'channel-2',
        channels: [
          {
            channelId: 'channel-2',
            name: 'Stored Channel',
            handle: '@stored-channel',
            thumbnail: 'https://img.youtube.test/stored-channel.jpg'
          }
        ],
        lastLoginAt: new Date('2026-05-31T09:00:00.000Z')
      })

      const user = await authenticateGoogleUser('oauth-code-2', fetcher)

      expect(mocks.createYoutubeClient).not.toHaveBeenCalled()
      expect(user.channels).toEqual([
        expect.objectContaining({
          channelId: 'channel-2',
          name: 'Stored Channel',
          handle: '@stored-channel',
          thumbnail: 'https://img.youtube.test/stored-channel.jpg'
        })
      ])
      expect(user.email).toBe('creator-two@example.com')
      expect(user.name).toBe('Creator Two')
    })
  })

  it('backfills a missing stored thumbnail by fetching YouTube once', async () => {
    const youtube = createYoutubeClientMock({
      channelId: 'channel-3',
      displayName: 'Refreshed Channel',
      handle: '@refreshed-channel',
      profilePictureUrl: 'https://img.youtube.test/refreshed-channel.jpg'
    })
    mocks.createYoutubeClient.mockReturnValue(youtube)
    const fetcher = createFetcher({
      tokenResponse: {
        access_token: 'access-token-3',
        expires_in: 3600,
        scope: 'openid email profile https://www.googleapis.com/auth/youtube.readonly'
      },
      profileResponse: {
        sub: 'google-subject-3',
        email: 'creator-three@example.com',
        name: 'Creator Three',
        picture: 'https://img.google.test/user-3.jpg'
      }
    })

    await withTemporaryEnv(oauthEnv, async () => {
      const existingUser = await User.create({
        googleSubject: 'google-subject-3',
        email: 'creator-three@example.com',
        name: 'Creator Three',
        picture: null,
        refreshToken: encryptSecret('stored-refresh-token'),
        activeChannelId: 'channel-3',
        channels: [
          {
            channelId: 'channel-3',
            name: 'Legacy Channel',
            handle: '@legacy-channel',
            thumbnail: null
          }
        ],
        lastLoginAt: new Date('2026-05-31T09:00:00.000Z')
      })

      const user = await authenticateGoogleUser('oauth-code-3', fetcher)

      expect(mocks.createYoutubeClient).toHaveBeenCalledWith({
        accessToken: 'access-token-3'
      })
      expect(youtube.channels.getAuthenticatedUser).toHaveBeenCalledTimes(1)
      expect(user.channels[0]?.thumbnail).toBe(
        'https://img.youtube.test/refreshed-channel.jpg'
      )

      const storedUser = await User.findById(existingUser._id).lean().exec()
      expect(storedUser?.channels[0]?.thumbnail).toBe(
        'https://img.youtube.test/refreshed-channel.jpg'
      )
    })
  })
})

describe('buildGoogleAuthorizationUrl', () => {
  it('requests write-capable YouTube scope for chat replies and moderation actions', async () => {
    await withTemporaryEnv(oauthEnv, async () => {
      const url = new URL(buildGoogleAuthorizationUrl('state-1'))
      const scopes = url.searchParams.get('scope')?.split(' ') ?? []

      expect(scopes).toEqual(
        expect.arrayContaining([
          'openid',
          'email',
          'profile',
          'https://www.googleapis.com/auth/youtube.force-ssl'
        ])
      )
      expect(scopes).not.toContain('https://www.googleapis.com/auth/youtube.readonly')
    })
  })
})
