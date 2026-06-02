const mocks = vi.hoisted(() => ({
  createYoutubeClient: vi.fn(),
  getFreshUserAccessToken: vi.fn()
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

vi.mock('../../src/services/google-auth-service.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../src/services/google-auth-service.js')
  >('../../src/services/google-auth-service.js')

  return {
    ...actual,
    getFreshUserAccessToken: mocks.getFreshUserAccessToken
  }
})

import { PlatformApiError } from 'unified-creator-metrics'

import { GoogleAuthServiceError } from '../../src/services/google-auth-service.js'
import {
  clearStreamOverviewCache,
  getStreamOverview
} from '../../src/services/livestream-service.js'

function createYoutubeClientMock() {
  return {
    livestreams: {
      getAuthenticatedChannelActive: vi.fn(),
      getAuthenticatedChannelScheduled: vi.fn()
    }
  }
}

describe('getStreamOverview', () => {
  beforeEach(() => {
    clearStreamOverviewCache()
    mocks.createYoutubeClient.mockReset()
    mocks.getFreshUserAccessToken.mockReset()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  afterEach(() => {
    clearStreamOverviewCache()
    vi.useRealTimers()
  })

  it('returns active and scheduled streams without extra viewer metric requests', async () => {
    const youtube = createYoutubeClientMock()
    mocks.getFreshUserAccessToken.mockResolvedValue('access-token')
    mocks.createYoutubeClient.mockReturnValue(youtube)
    youtube.livestreams.getAuthenticatedChannelActive.mockResolvedValue([
      {
        streamId: 'live-video-1',
        platform: 'youtube',
        channelId: 'channel-1',
        title: 'Live stream',
        status: 'live',
        concurrentViewers: 128,
        startedAt: '2026-05-31T12:00:00.000Z',
        fetchedAt: '2026-05-31T12:01:00.000Z'
      }
    ])
    youtube.livestreams.getAuthenticatedChannelScheduled.mockResolvedValue([
      {
        streamId: 'scheduled-video-1',
        platform: 'youtube',
        channelId: 'channel-1',
        title: 'Scheduled stream',
        status: 'upcoming',
        concurrentViewers: null,
        startedAt: '2026-05-31T13:00:00.000Z',
        fetchedAt: '2026-05-31T12:01:00.000Z'
      }
    ])

    const result = await getStreamOverview({} as any, 'channel-1')

    expect(mocks.createYoutubeClient).toHaveBeenCalledWith({
      accessToken: 'access-token'
    })
    expect(youtube.livestreams.getAuthenticatedChannelActive).toHaveBeenCalledTimes(1)
    expect(youtube.livestreams.getAuthenticatedChannelScheduled).toHaveBeenCalledTimes(1)
    expect(result.active).toEqual([
      expect.objectContaining({
        id: 'live-video-1',
        title: 'Live stream',
        status: 'live',
        viewerCount: 128
      })
    ])
    expect(result.scheduled).toEqual([
      expect.objectContaining({
        id: 'scheduled-video-1',
        title: 'Scheduled stream',
        status: 'upcoming',
        viewerCount: null
      })
    ])
  })

  it('reuses a cached stream overview within the cache ttl', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-31T12:00:00.000Z'))
    const youtube = createYoutubeClientMock()
    mocks.getFreshUserAccessToken.mockResolvedValue('access-token')
    mocks.createYoutubeClient.mockReturnValue(youtube)
    youtube.livestreams.getAuthenticatedChannelActive.mockResolvedValue([
      {
        streamId: 'live-video-1',
        platform: 'youtube',
        channelId: 'channel-1',
        title: 'Live stream',
        status: 'live',
        concurrentViewers: 128,
        startedAt: '2026-05-31T12:00:00.000Z',
        fetchedAt: '2026-05-31T12:01:00.000Z'
      }
    ])
    youtube.livestreams.getAuthenticatedChannelScheduled.mockResolvedValue([])

    const user = { googleSubject: 'google-user-1' } as any
    const first = await getStreamOverview(user, 'channel-1')
    first.active[0].title = 'Mutated by caller'
    const second = await getStreamOverview(user, 'channel-1')

    expect(mocks.getFreshUserAccessToken).toHaveBeenCalledTimes(1)
    expect(mocks.createYoutubeClient).toHaveBeenCalledTimes(1)
    expect(youtube.livestreams.getAuthenticatedChannelActive).toHaveBeenCalledTimes(1)
    expect(youtube.livestreams.getAuthenticatedChannelScheduled).toHaveBeenCalledTimes(1)
    expect(second.active).toEqual([
      expect.objectContaining({
        id: 'live-video-1',
        title: 'Live stream'
      })
    ])
  })

  it('shares an in-flight stream overview lookup for concurrent requests', async () => {
    const youtube = createYoutubeClientMock()
    let resolveActive!: (streams: any[]) => void
    const activePromise = new Promise<any[]>((resolve) => {
      resolveActive = resolve
    })
    mocks.getFreshUserAccessToken.mockResolvedValue('access-token')
    mocks.createYoutubeClient.mockReturnValue(youtube)
    youtube.livestreams.getAuthenticatedChannelActive.mockReturnValue(activePromise)
    youtube.livestreams.getAuthenticatedChannelScheduled.mockResolvedValue([])

    const user = { googleSubject: 'google-user-1' } as any
    const first = getStreamOverview(user, 'channel-1')
    const second = getStreamOverview(user, 'channel-1')

    resolveActive([
      {
        streamId: 'live-video-1',
        platform: 'youtube',
        channelId: 'channel-1',
        title: 'Live stream',
        status: 'live',
        concurrentViewers: 128,
        startedAt: '2026-05-31T12:00:00.000Z',
        fetchedAt: '2026-05-31T12:01:00.000Z'
      }
    ])

    const [firstResult, secondResult] = await Promise.all([first, second])

    expect(mocks.getFreshUserAccessToken).toHaveBeenCalledTimes(1)
    expect(youtube.livestreams.getAuthenticatedChannelActive).toHaveBeenCalledTimes(1)
    expect(firstResult.active).toEqual(secondResult.active)
  })

  it('refreshes the stream overview when forced', async () => {
    const youtube = createYoutubeClientMock()
    mocks.getFreshUserAccessToken.mockResolvedValue('access-token')
    mocks.createYoutubeClient.mockReturnValue(youtube)
    youtube.livestreams.getAuthenticatedChannelActive
      .mockResolvedValueOnce([
        {
          streamId: 'live-video-1',
          platform: 'youtube',
          channelId: 'channel-1',
          title: 'First live stream',
          status: 'live',
          concurrentViewers: 128,
          startedAt: '2026-05-31T12:00:00.000Z',
          fetchedAt: '2026-05-31T12:01:00.000Z'
        }
      ])
      .mockResolvedValueOnce([
        {
          streamId: 'live-video-2',
          platform: 'youtube',
          channelId: 'channel-1',
          title: 'Fresh live stream',
          status: 'live',
          concurrentViewers: 256,
          startedAt: '2026-05-31T12:10:00.000Z',
          fetchedAt: '2026-05-31T12:11:00.000Z'
        }
      ])
    youtube.livestreams.getAuthenticatedChannelScheduled.mockResolvedValue([])

    const user = { googleSubject: 'google-user-1' } as any
    await getStreamOverview(user, 'channel-1')
    const refreshed = await getStreamOverview(user, 'channel-1', {
      forceRefresh: true
    })

    expect(mocks.getFreshUserAccessToken).toHaveBeenCalledTimes(2)
    expect(youtube.livestreams.getAuthenticatedChannelActive).toHaveBeenCalledTimes(2)
    expect(refreshed.active).toEqual([
      expect.objectContaining({
        id: 'live-video-2',
        title: 'Fresh live stream',
        viewerCount: 256
      })
    ])
  })

  it('refreshes the cached stream overview after the ttl expires', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-31T12:00:00.000Z'))
    const youtube = createYoutubeClientMock()
    mocks.getFreshUserAccessToken.mockResolvedValue('access-token')
    mocks.createYoutubeClient.mockReturnValue(youtube)
    youtube.livestreams.getAuthenticatedChannelActive
      .mockResolvedValueOnce([
        {
          streamId: 'live-video-1',
          platform: 'youtube',
          channelId: 'channel-1',
          title: 'First live stream',
          status: 'live',
          concurrentViewers: 128,
          startedAt: '2026-05-31T12:00:00.000Z',
          fetchedAt: '2026-05-31T12:01:00.000Z'
        }
      ])
      .mockResolvedValueOnce([
        {
          streamId: 'live-video-2',
          platform: 'youtube',
          channelId: 'channel-1',
          title: 'Second live stream',
          status: 'live',
          concurrentViewers: 64,
          startedAt: '2026-05-31T12:02:00.000Z',
          fetchedAt: '2026-05-31T12:03:00.000Z'
        }
      ])
    youtube.livestreams.getAuthenticatedChannelScheduled.mockResolvedValue([])

    const user = { googleSubject: 'google-user-1' } as any
    await getStreamOverview(user, 'channel-1')
    vi.setSystemTime(new Date('2026-05-31T12:01:01.000Z'))
    const result = await getStreamOverview(user, 'channel-1')

    expect(mocks.getFreshUserAccessToken).toHaveBeenCalledTimes(2)
    expect(youtube.livestreams.getAuthenticatedChannelActive).toHaveBeenCalledTimes(2)
    expect(result.active).toEqual([
      expect.objectContaining({
        id: 'live-video-2',
        title: 'Second live stream'
      })
    ])
  })

  it('keeps returning streams when the upstream response has no viewer count', async () => {
    const youtube = createYoutubeClientMock()
    mocks.getFreshUserAccessToken.mockResolvedValue('access-token')
    mocks.createYoutubeClient.mockReturnValue(youtube)
    youtube.livestreams.getAuthenticatedChannelActive.mockResolvedValue([
      {
        streamId: 'live-video-1',
        platform: 'youtube',
        channelId: 'channel-1',
        title: 'Live stream',
        status: 'live',
        concurrentViewers: null,
        startedAt: '2026-05-31T12:00:00.000Z',
        fetchedAt: '2026-05-31T12:01:00.000Z'
      }
    ])
    youtube.livestreams.getAuthenticatedChannelScheduled.mockResolvedValue([])

    const result = await getStreamOverview({} as any, 'channel-1')

    expect(result.active).toEqual([
      expect.objectContaining({
        id: 'live-video-1',
        title: 'Live stream',
        status: 'live',
        viewerCount: null
      })
    ])
  })

  it('filters authenticated-channel streams to the requested channel id', async () => {
    const youtube = createYoutubeClientMock()
    mocks.getFreshUserAccessToken.mockResolvedValue('access-token')
    mocks.createYoutubeClient.mockReturnValue(youtube)
    youtube.livestreams.getAuthenticatedChannelActive.mockResolvedValue([
      {
        streamId: 'live-video-1',
        platform: 'youtube',
        channelId: 'channel-1',
        title: 'Live stream',
        status: 'live',
        concurrentViewers: 64,
        startedAt: '2026-05-31T12:00:00.000Z',
        fetchedAt: '2026-05-31T12:01:00.000Z'
      },
      {
        streamId: 'live-video-2',
        platform: 'youtube',
        channelId: 'channel-2',
        title: 'Other channel live stream',
        status: 'live',
        concurrentViewers: 32,
        startedAt: '2026-05-31T12:05:00.000Z',
        fetchedAt: '2026-05-31T12:06:00.000Z'
      }
    ])
    youtube.livestreams.getAuthenticatedChannelScheduled.mockResolvedValue([
      {
        streamId: 'scheduled-video-2',
        platform: 'youtube',
        channelId: 'channel-2',
        title: 'Other channel scheduled stream',
        status: 'upcoming',
        concurrentViewers: null,
        startedAt: '2026-05-31T13:00:00.000Z',
        fetchedAt: '2026-05-31T12:01:00.000Z'
      }
    ])

    const result = await getStreamOverview({} as any, 'channel-1')

    expect(result.active).toEqual([
      expect.objectContaining({
        id: 'live-video-1'
      })
    ])
    expect(result.scheduled).toEqual([])
  })

  it('returns a degraded overview when Google authorization has expired', async () => {
    mocks.getFreshUserAccessToken.mockRejectedValue(
      new GoogleAuthServiceError(
        'TOKEN_REFRESH_FAILED',
        'Failed to refresh Google access token'
      )
    )

    const result = await getStreamOverview({} as any, 'channel-1')

    expect(result).toMatchObject({
      active: [],
      scheduled: [],
      warning: 'Google authorization expired. Sign in again to load stream data.'
    })
    expect(result.fetchedAt).toBeDefined()
  })

  it('returns a degraded overview when the YouTube API request fails', async () => {
    const youtube = createYoutubeClientMock()
    mocks.getFreshUserAccessToken.mockResolvedValue('access-token')
    mocks.createYoutubeClient.mockReturnValue(youtube)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    youtube.livestreams.getAuthenticatedChannelActive.mockRejectedValue(
      new PlatformApiError('YouTube API request failed.', {
        platform: 'youtube',
        status: 403,
        cause: {
          response: {
            status: 403,
            data: {
              error: {
                message: 'Request had insufficient authentication scopes.',
                errors: [{ reason: 'insufficientPermissions' }]
              }
            }
          }
        }
      })
    )
    youtube.livestreams.getAuthenticatedChannelScheduled.mockResolvedValue([])

    const result = await getStreamOverview({} as any, 'channel-1')

    expect(result).toMatchObject({
      active: [],
      scheduled: [],
      warning: 'Google authorization is missing the required YouTube access. Sign in again and retry.'
    })
    expect(result.fetchedAt).toBeDefined()
    expect(warnSpy).toHaveBeenCalledWith('YouTube stream overview lookup failed', {
      status: 403,
      reason: 'insufficientPermissions',
      message: 'Request had insufficient authentication scopes.'
    })
  })

  it('returns a project configuration warning when the YouTube API is disabled', async () => {
    const youtube = createYoutubeClientMock()
    mocks.getFreshUserAccessToken.mockResolvedValue('access-token')
    mocks.createYoutubeClient.mockReturnValue(youtube)
    youtube.livestreams.getAuthenticatedChannelActive.mockRejectedValue(
      new PlatformApiError('YouTube API request failed.', {
        platform: 'youtube',
        status: 403,
        cause: {
          response: {
            status: 403,
            data: {
              error: {
                message: 'YouTube Data API has not been used in project before or it is disabled.',
                errors: [{ reason: 'accessNotConfigured' }]
              }
            }
          }
        }
      })
    )
    youtube.livestreams.getAuthenticatedChannelScheduled.mockResolvedValue([])

    const result = await getStreamOverview({} as any, 'channel-1')

    expect(result).toMatchObject({
      active: [],
      scheduled: [],
      warning: 'The YouTube Data API is not enabled for this Google Cloud project.'
    })
  })
})
