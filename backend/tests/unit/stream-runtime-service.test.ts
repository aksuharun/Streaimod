import {
  clearManagedStreamRuntimesForTest,
  getManagedStreamRuntimeStatus,
  startManagedStreamRuntime,
  stopAllManagedStreamRuntimes,
  stopManagedStreamRuntime
} from '../../src/services/stream-runtime-service.js'

function createRuntimeFactory() {
  const runtimes: Array<{
    start: ReturnType<typeof vi.fn>
    stop: ReturnType<typeof vi.fn>
  }> = []

  const runtimeFactory = vi.fn((_config) => {
    const runtime = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined)
    }
    runtimes.push(runtime)
    return runtime
  })

  return { runtimeFactory, runtimes }
}

describe('stream-runtime-service', () => {
  beforeEach(() => {
    clearManagedStreamRuntimesForTest()
  })

  afterEach(async () => {
    await stopAllManagedStreamRuntimes()
    clearManagedStreamRuntimesForTest()
  })

  it('starts and reports a managed runtime for the channel', async () => {
    const { runtimeFactory, runtimes } = createRuntimeFactory()

    const status = await startManagedStreamRuntime(
      {
        channelId: 'channel-1',
        streamId: 'stream-1',
        ingestUrl: 'http://127.0.0.1:3000/api/chat/ingest'
      },
      runtimeFactory as any
    )

    expect(runtimeFactory).toHaveBeenCalledTimes(1)
    expect(runtimeFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'channel-1',
        liveVideoId: 'stream-1',
        ingestUrl: 'http://127.0.0.1:3000/api/chat/ingest',
        includeHistory: false,
        getAccessToken: expect.any(Function)
      })
    )
    expect(runtimes[0]?.start).toHaveBeenCalledTimes(1)
    expect(status).toEqual(
      expect.objectContaining({
        active: true,
        channelId: 'channel-1',
        streamId: 'stream-1'
      })
    )
    expect(getManagedStreamRuntimeStatus('channel-1')).toEqual(status)
  })

  it('does not restart a runtime already running for the same channel and stream', async () => {
    const { runtimeFactory, runtimes } = createRuntimeFactory()

    await startManagedStreamRuntime(
      {
        channelId: 'channel-1',
        streamId: 'stream-1',
        ingestUrl: 'http://127.0.0.1:3000/api/chat/ingest'
      },
      runtimeFactory as any
    )

    await startManagedStreamRuntime(
      {
        channelId: 'channel-1',
        streamId: 'stream-1',
        ingestUrl: 'http://127.0.0.1:3000/api/chat/ingest'
      },
      runtimeFactory as any
    )

    expect(runtimeFactory).toHaveBeenCalledTimes(1)
    expect(runtimes[0]?.start).toHaveBeenCalledTimes(1)
    expect(runtimes[0]?.stop).not.toHaveBeenCalled()
  })

  it('replaces an existing runtime when a different live stream is started', async () => {
    const { runtimeFactory, runtimes } = createRuntimeFactory()

    await startManagedStreamRuntime(
      {
        channelId: 'channel-1',
        streamId: 'stream-1',
        ingestUrl: 'http://127.0.0.1:3000/api/chat/ingest'
      },
      runtimeFactory as any
    )

    await startManagedStreamRuntime(
      {
        channelId: 'channel-1',
        streamId: 'stream-2',
        ingestUrl: 'http://127.0.0.1:3000/api/chat/ingest'
      },
      runtimeFactory as any
    )

    expect(runtimeFactory).toHaveBeenCalledTimes(2)
    expect(runtimes[0]?.stop).toHaveBeenCalledTimes(1)
    expect(runtimes[1]?.start).toHaveBeenCalledTimes(1)
    expect(getManagedStreamRuntimeStatus('channel-1')).toEqual(
      expect.objectContaining({
        active: true,
        streamId: 'stream-2'
      })
    )
  })

  it('stops a managed runtime and clears the channel status', async () => {
    const { runtimeFactory, runtimes } = createRuntimeFactory()

    await startManagedStreamRuntime(
      {
        channelId: 'channel-1',
        streamId: 'stream-1',
        ingestUrl: 'http://127.0.0.1:3000/api/chat/ingest'
      },
      runtimeFactory as any
    )

    const status = await stopManagedStreamRuntime('channel-1')

    expect(runtimes[0]?.stop).toHaveBeenCalledTimes(1)
    expect(status).toEqual({
      active: false,
      channelId: 'channel-1',
      streamId: null,
      startedAt: null
    })
  })
})
