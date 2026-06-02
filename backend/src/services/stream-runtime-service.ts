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

function logModerationStarted(channelId: string, streamId: string): void {
  console.info('Moderation started', {
    channelId,
    streamId
  })
}

function logModerationStopped(channelId: string, streamId: string): void {
  console.info('Moderation stopped', {
    channelId,
    streamId
  })
}

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
    return getManagedStreamRuntimeStatus(input.channelId)
  }

  if (existing) {
    await existing.runtime.stop()
    managedRuntimes.delete(input.channelId)
    logModerationStopped(input.channelId, existing.streamId)
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
  logModerationStarted(input.channelId, input.streamId)

  return getManagedStreamRuntimeStatus(input.channelId)
}

export async function stopManagedStreamRuntime(channelId: string): Promise<StreamRuntimeStatus> {
  const existing = managedRuntimes.get(channelId)

  if (!existing) {
    return getManagedStreamRuntimeStatus(channelId)
  }

  managedRuntimes.delete(channelId)
  await existing.runtime.stop()
  logModerationStopped(channelId, existing.streamId)

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
