import { createYoutubeProducerRuntime, type YoutubeProducerRuntime } from '../runtime/youtube-producer.js'
import { User } from '../models/user.js'
import { getFreshUserAccessToken } from './google-auth-service.js'

export interface StreamRuntimeStatus {
  active: boolean
  channelId: string
  streamId: string | null
  startedAt: string | null
}

interface ManagedRuntimeRecord {
  runtime: YoutubeProducerRuntime
  channelId: string
  streamId: string
  startedAt: string
}

type RuntimeFactory = typeof createYoutubeProducerRuntime

const managedRuntimes = new Map<string, ManagedRuntimeRecord>()

function createAccessTokenResolver(channelId: string): () => Promise<string> {
  return async () => {
    const user = await User.findOne({ 'channels.channelId': channelId }).exec()

    if (!user) {
      throw new Error(`No authenticated YouTube user found for channel ${channelId}`)
    }

    return getFreshUserAccessToken(user)
  }
}

export function getManagedStreamRuntimeStatus(channelId: string): StreamRuntimeStatus {
  const runtime = managedRuntimes.get(channelId)

  if (!runtime) {
    return {
      active: false,
      channelId,
      streamId: null,
      startedAt: null
    }
  }

  return {
    active: true,
    channelId,
    streamId: runtime.streamId,
    startedAt: runtime.startedAt
  }
}

export async function startManagedStreamRuntime(
  input: {
    channelId: string
    streamId: string
    ingestUrl: string
    timeoutDurationSeconds?: number
  },
  runtimeFactory: RuntimeFactory = createYoutubeProducerRuntime
): Promise<StreamRuntimeStatus> {
  const existing = managedRuntimes.get(input.channelId)

  if (existing && existing.streamId === input.streamId) {
    console.info('Managed stream runtime already active', {
      channelId: input.channelId,
      streamId: input.streamId
    })
    return getManagedStreamRuntimeStatus(input.channelId)
  }

  if (existing) {
    console.info('Replacing managed stream runtime', {
      channelId: input.channelId,
      previousStreamId: existing.streamId,
      nextStreamId: input.streamId
    })
    await existing.runtime.stop()
    managedRuntimes.delete(input.channelId)
  }

  const runtime = runtimeFactory({
    channelId: input.channelId,
    liveVideoId: input.streamId,
    ingestUrl: input.ingestUrl,
    includeHistory: false,
    timeoutDurationSeconds: input.timeoutDurationSeconds,
    getAccessToken: createAccessTokenResolver(input.channelId)
  })

  try {
    console.info('Starting managed stream runtime', {
      channelId: input.channelId,
      streamId: input.streamId,
      ingestUrl: input.ingestUrl
    })
    await runtime.start()
  } catch (error) {
    await runtime.stop().catch(() => undefined)
    throw error
  }

  managedRuntimes.set(input.channelId, {
    runtime,
    channelId: input.channelId,
    streamId: input.streamId,
    startedAt: new Date().toISOString()
  })

  return getManagedStreamRuntimeStatus(input.channelId)
}

export async function stopManagedStreamRuntime(channelId: string): Promise<StreamRuntimeStatus> {
  const existing = managedRuntimes.get(channelId)

  if (!existing) {
    console.info('Managed stream runtime already stopped', { channelId })
    return getManagedStreamRuntimeStatus(channelId)
  }

  managedRuntimes.delete(channelId)
  console.info('Stopping managed stream runtime', {
    channelId,
    streamId: existing.streamId
  })
  await existing.runtime.stop()

  return getManagedStreamRuntimeStatus(channelId)
}

export async function stopAllManagedStreamRuntimes(): Promise<void> {
  const runtimes = Array.from(managedRuntimes.values())
  managedRuntimes.clear()

  await Promise.all(runtimes.map(async ({ runtime }) => runtime.stop()))
}

export function clearManagedStreamRuntimesForTest(): void {
  managedRuntimes.clear()
}
