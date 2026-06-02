import request from 'supertest'

import { setStreamRouteDependencies } from '../../src/routes/stream-routes.js'
import type { StreamOverviewDto } from '../../src/services/livestream-service.js'
import { createTestApp } from '../helpers/test-app.js'

describe('stream routes', () => {
  it('passes explicit refresh requests to the stream overview service', async () => {
    const getStreamOverview = vi.fn(async (): Promise<StreamOverviewDto> => ({
      active: [],
      scheduled: [],
      fetchedAt: '2026-05-31T12:01:00.000Z'
    }))
    const app = createTestApp((expressApp) => {
      setStreamRouteDependencies(expressApp, {
        getStreamOverview
      })
    })

    await request(app).get('/api/streams?refresh=true').expect(200)

    expect(getStreamOverview).toHaveBeenCalledWith(
      expect.anything(),
      '*',
      { forceRefresh: true }
    )
  })

  it('returns authenticated stream status for the active channel', async () => {
    const app = createTestApp((expressApp) => {
      setStreamRouteDependencies(expressApp, {
        getManagedStreamRuntimeStatus: vi.fn(() => ({
          active: true,
          channelId: '*',
          streamId: 'stream-1',
          startedAt: '2026-05-31T12:00:00.000Z'
        }))
      })
    })

    const response = await request(app).get('/api/stream/status').expect(200)

    expect(response.body).toEqual({
      active: true,
      channelId: '*',
      streamId: 'stream-1',
      startedAt: '2026-05-31T12:00:00.000Z'
    })
  })

  it('starts moderation for an active live stream owned by the authenticated channel', async () => {
    const getStreamOverview = vi.fn(async (): Promise<StreamOverviewDto> => ({
      active: [
        {
          id: 'live-video-1',
          platform: 'youtube' as const,
          title: 'Live stream',
          status: 'live' as const,
          viewerCount: 128,
          startsAt: '2026-05-31T12:00:00.000Z',
          fetchedAt: '2026-05-31T12:01:00.000Z'
        }
      ],
      scheduled: [],
      fetchedAt: '2026-05-31T12:01:00.000Z'
    }))
    const startManagedStreamRuntime = vi.fn(async () => ({
      active: true,
      channelId: '*',
      streamId: 'live-video-1',
      startedAt: '2026-05-31T12:02:00.000Z'
    }))

    const app = createTestApp((expressApp) => {
      setStreamRouteDependencies(expressApp, {
        getStreamOverview,
        startManagedStreamRuntime
      })
    })

    const response = await request(app)
      .post('/api/stream/start')
      .send({ streamId: 'live-video-1' })
      .expect(200)

    expect(getStreamOverview).toHaveBeenCalledTimes(1)
    expect(startManagedStreamRuntime).toHaveBeenCalledWith({
      channelId: '*',
      streamId: 'live-video-1',
      ingestUrl: expect.stringMatching(/\/api\/chat\/ingest$/)
    })
    expect(response.body).toEqual({
      active: true,
      channelId: '*',
      streamId: 'live-video-1',
      startedAt: '2026-05-31T12:02:00.000Z'
    })
  })

  it('rejects starting moderation for a stream that is not currently active', async () => {
    const app = createTestApp((expressApp) => {
      setStreamRouteDependencies(expressApp, {
        getStreamOverview: vi.fn(async (): Promise<StreamOverviewDto> => ({
          active: [],
          scheduled: [],
          fetchedAt: '2026-05-31T12:01:00.000Z'
        }))
      })
    })

    const response = await request(app)
      .post('/api/stream/start')
      .send({ streamId: 'missing-stream' })
      .expect(404)

    expect(response.body).toEqual({
      error: 'Active stream not found for the selected channel'
    })
  })

  it('stops moderation for the active channel', async () => {
    const stopManagedStreamRuntime = vi.fn(async () => ({
      active: false,
      channelId: '*',
      streamId: null,
      startedAt: null
    }))

    const app = createTestApp((expressApp) => {
      setStreamRouteDependencies(expressApp, {
        stopManagedStreamRuntime
      })
    })

    const response = await request(app).post('/api/stream/stop').send({}).expect(200)

    expect(stopManagedStreamRuntime).toHaveBeenCalledWith('*')
    expect(response.body).toEqual({
      active: false,
      channelId: '*',
      streamId: null,
      startedAt: null
    })
  })
})
