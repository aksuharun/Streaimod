import { Store } from '@geajs/core'
import { api, type StreamRuntimeStatus, type StreamSummary } from '../services/api'
import { buildBackendUrl } from '../services/backend-url'

export interface ChannelMeta {
  id: string
  name: string
  handle: string | null
  thumbnail: string | null
  qnaEnabled: boolean
  moderationEnabled: boolean
}

class ChannelStore extends Store {
  activeChannel: string = ''
  channels: ChannelMeta[] = []
  backendHealth: 'ok' | 'error' | 'loading' | 'unknown' = 'unknown'
  streamActive = false
  streamStatusChecked = false
  moderatedStreamId: string | null = null
  moderationRuntimeStartedAt: string | null = null
  moderationRuntimeLoading = false
  streams: StreamSummary[] = []
  streamsLoading = false
  streamsLoaded = false
  streamsError: string | null = null
  streamsFetchedAt: string | null = null
  streamsChannelId: string | null = null

  get hasConfiguredChannel(): boolean {
    return this.channels.length > 0 && this.activeChannel.length > 0
  }

  hydrate(channels: ChannelMeta[], activeChannelId: string) {
    this.channels = channels
    this.activeChannel = channels.some((channel) => channel.id === activeChannelId)
      ? activeChannelId
      : channels[0]?.id ?? ''
  }

  clear() {
    this.activeChannel = ''
    this.channels = []
    this.streamActive = false
    this.streamStatusChecked = false
    this.moderatedStreamId = null
    this.moderationRuntimeStartedAt = null
    this.moderationRuntimeLoading = false
    this.streams = []
    this.streamsLoading = false
    this.streamsLoaded = false
    this.streamsError = null
    this.streamsFetchedAt = null
    this.streamsChannelId = null
  }

  get channelId() {
    return this.activeChannel
  }

  set channelId(value: string) {
    this.setActiveChannel(value)
  }

  get activeChannelMeta(): ChannelMeta | null {
    return this.channels.find((channel) => channel.id === this.activeChannel) ?? null
  }

  patchChannelSettings(
    channelId: string,
    settings: Partial<Pick<ChannelMeta, 'qnaEnabled' | 'moderationEnabled'>>
  ) {
    this.channels = this.channels.map((channel) =>
      channel.id === channelId ? { ...channel, ...settings } : channel
    )
  }

  getChannelMeta(channelId?: string): ChannelMeta | null {
    if (!channelId || channelId === this.activeChannel) {
      return this.activeChannelMeta
    }

    const id = channelId ?? this.activeChannel
    return this.channels.find(c => c.id === id) ?? null
  }

  get activeStreams(): StreamSummary[] {
    return this.streams.filter((stream) => stream.status === 'live')
  }

  get scheduledStreams(): StreamSummary[] {
    return this.streams.filter((stream) => stream.status === 'upcoming')
  }

  get visibleStreams(): StreamSummary[] {
    return [...this.activeStreams, ...this.scheduledStreams]
  }

  get hasVisibleStreams(): boolean {
    return this.visibleStreams.length > 0
  }

  get moderatedStream(): StreamSummary | null {
    if (!this.moderatedStreamId) {
      return null
    }

    return this.streams.find((stream) => stream.id === this.moderatedStreamId) ?? null
  }

  get streamStatusLabel(): 'loading' | 'live' | 'scheduled' | 'empty' | 'error' | 'unknown' {
    if (this.streamsLoading) return 'loading'
    if (this.streamsError) return 'error'
    if (!this.streamsLoaded) return 'unknown'
    if (this.activeStreams.length > 0) return 'live'
    if (this.scheduledStreams.length > 0) return 'scheduled'
    return 'empty'
  }

  private async fetchWithTimeout(url: string, timeoutMs = 8000) {
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await fetch(buildBackendUrl(url), {
        credentials: 'include',
        signal: controller.signal
      })
    } finally {
      window.clearTimeout(timeoutId)
    }
  }

  async checkHealth() {
    this.backendHealth = 'loading'
    try {
      const response = await this.fetchWithTimeout('/health', 5000)
      if (response.ok) {
        const data = await response.json()
        this.backendHealth = data.status === 'ok' ? 'ok' : 'error'
      } else {
        this.backendHealth = 'error'
      }
    } catch (err) {
      console.error('Health check failed:', err)
      this.backendHealth = 'error'
    }
  }

  async loadStreams(
    channelId = this.activeChannel,
    options: { refresh?: boolean } = {}
  ) {
    if (!channelId) {
      this.streams = []
      this.streamsLoaded = true
      this.streamsLoading = false
      this.streamsError = null
      this.streamsChannelId = null
      this.streamActive = false
      this.streamStatusChecked = true
      this.moderatedStreamId = null
      this.moderationRuntimeStartedAt = null
      return
    }

    this.streamsChannelId = channelId
    this.streamsLoading = true
    this.streamsLoaded = false
    this.streamsError = null

    try {
      const [overview, runtimeStatus] = await Promise.all([
        api.getStreamOverview(channelId, { refresh: options.refresh }),
        api.getStreamRuntimeStatus(channelId)
      ])
      if (this.activeChannel !== channelId) return
      this.streams = [...overview.active, ...overview.scheduled]
      this.streamsFetchedAt = overview.fetchedAt
      this.applyRuntimeStatus(runtimeStatus)
      this.streamsLoaded = true
      this.streamsError = overview.warning ?? null
    } catch (err: any) {
      if (this.activeChannel !== channelId) return
      this.streams = []
      this.streamActive = false
      this.streamStatusChecked = true
      this.moderatedStreamId = null
      this.moderationRuntimeStartedAt = null
      this.streamsLoaded = true
      this.streamsError = err.message || 'Unable to check live streams'
    } finally {
      if (this.streamsChannelId === channelId) {
        this.streamsLoading = false
      }
    }
  }

  applyRuntimeStatus(status: StreamRuntimeStatus) {
    this.streamActive = status.active
    this.streamStatusChecked = true
    this.moderatedStreamId = status.streamId
    this.moderationRuntimeStartedAt = status.startedAt
  }

  async checkStreamStatus(channelId = this.activeChannel) {
    try {
      const status = await api.getStreamRuntimeStatus(channelId)
      this.applyRuntimeStatus(status)
    } catch {
      this.streamActive = false
      this.moderatedStreamId = null
      this.moderationRuntimeStartedAt = null
    } finally {
      this.streamStatusChecked = true
    }
  }

  async startModeration(streamId: string, channelId = this.activeChannel) {
    if (!channelId) {
      throw new Error('No active channel selected')
    }

    if (this.moderationRuntimeLoading || this.moderatedStreamId === streamId) {
      return {
        active: this.moderatedStreamId === streamId,
        channelId,
        streamId: this.moderatedStreamId,
        startedAt: this.moderationRuntimeStartedAt
      }
    }

    this.moderationRuntimeLoading = true

    try {
      const status = await api.startStreamRuntime({ channelId, streamId })
      this.applyRuntimeStatus(status)
      return status
    } finally {
      this.moderationRuntimeLoading = false
    }
  }

  async stopModeration(channelId = this.activeChannel) {
    if (!channelId) {
      throw new Error('No active channel selected')
    }

    if (this.moderationRuntimeLoading || !this.moderatedStreamId) {
      return {
        active: false,
        channelId,
        streamId: this.moderatedStreamId,
        startedAt: this.moderationRuntimeStartedAt
      }
    }

    this.moderationRuntimeLoading = true

    try {
      const status = await api.stopStreamRuntime({ channelId })
      this.applyRuntimeStatus(status)
      return status
    } finally {
      this.moderationRuntimeLoading = false
    }
  }

  setActiveChannel(channelId: string) {
    const trimmed = channelId.trim()
    if (!trimmed || !this.channels.some((channel) => channel.id === trimmed)) return

    this.activeChannel = trimmed
  }
}

const channelStore = new ChannelStore()
export default channelStore
