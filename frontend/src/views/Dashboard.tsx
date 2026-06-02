import { Component } from '@geajs/core'
import { Button, Card, CardContent, CardHeader, CardTitle, Badge } from '@geajs/ui'
import channelStore from '../stores/channel-store'
import { router } from '../router'
import type { StreamSummary } from '../services/api'
import { showErrorToast, showSuccessToast } from '../services/toast'

function formatStartTime(value: string | null): string {
  if (!value) return 'Time not set'

  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    }).format(new Date(value))
  } catch {
    return 'Time not set'
  }
}

function formatSyncTime(value: string | null): string {
  if (!value) return 'Not synced yet'

  try {
    return `Synced ${new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit'
    }).format(new Date(value))}`
  } catch {
    return 'Synced recently'
  }
}

function formatRuntimeTime(value: string | null): string {
  if (!value) return 'Stopped'

  try {
    return `Running since ${new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit'
    }).format(new Date(value))}`
  } catch {
    return 'Running'
  }
}

function getHealthLabel(healthStatus: 'ok' | 'error' | 'loading' | 'unknown'): string {
  return healthStatus === 'ok'
    ? 'API online'
    : healthStatus === 'loading'
      ? 'Checking API'
      : healthStatus === 'error'
        ? 'API unavailable'
        : 'API not checked'
}

function getHealthClass(healthStatus: 'ok' | 'error' | 'loading' | 'unknown'): string {
  return healthStatus === 'ok'
    ? 'status-pill status-pill-ok'
    : healthStatus === 'error'
      ? 'status-pill status-pill-error'
      : 'status-pill status-pill-muted'
}

function getStreamLabel(
  streamStatus: 'loading' | 'live' | 'scheduled' | 'empty' | 'error' | 'unknown',
  activeCount: number,
  scheduledCount: number
): string {
  return streamStatus === 'live'
    ? `${activeCount} live`
    : streamStatus === 'scheduled'
      ? `${scheduledCount} scheduled`
      : streamStatus === 'loading'
        ? 'Checking streams'
        : streamStatus === 'error'
          ? 'Stream check failed'
          : streamStatus === 'empty'
            ? 'No streams'
            : 'Streams not checked'
}

function getStreamClass(
  streamStatus: 'loading' | 'live' | 'scheduled' | 'empty' | 'error' | 'unknown'
): string {
  return streamStatus === 'live'
    ? 'status-pill status-pill-live'
    : streamStatus === 'error'
      ? 'status-pill status-pill-error'
      : 'status-pill status-pill-muted'
}

const loadingButtonClass = 'inline-flex min-w-[10rem] cursor-not-allowed items-center justify-center rounded-md border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-medium text-slate-400 opacity-80'
const stopButtonClass = 'inline-flex min-w-[10rem] items-center justify-center rounded-md border border-rose-500/40 bg-rose-500/15 px-4 py-2 text-sm font-medium text-rose-100 transition hover:bg-rose-500/25'
const startButtonClass = 'inline-flex min-w-[10rem] items-center justify-center rounded-md border border-emerald-400/30 bg-emerald-400/15 px-4 py-2 text-sm font-medium text-emerald-100 transition hover:bg-emerald-400/25'

export default class Dashboard extends Component {
  lastLoadedChannel = ''
  syncing = false
  channelMeta = channelStore.activeChannelMeta
  backendHealth = channelStore.backendHealth
  streamsLoading = channelStore.streamsLoading
  streamsLoaded = channelStore.streamsLoaded
  streamsError = channelStore.streamsError
  streamsFetchedAt = channelStore.streamsFetchedAt
  activeStreams: StreamSummary[] = channelStore.activeStreams
  scheduledStreams: StreamSummary[] = channelStore.scheduledStreams
  visibleStreams: StreamSummary[] = channelStore.visibleStreams
  moderatedStreamId = channelStore.moderatedStreamId
  runtimeStartedAt = channelStore.moderationRuntimeStartedAt
  runtimeLoading = channelStore.moderationRuntimeLoading
  removeChannelObservers: Array<() => void> = []
  handleRefresh!: () => void
  handleOpenQna!: () => void
  handleOpenRules!: () => void
  handleStartModeration!: (streamId: string, title: string | null) => Promise<void>
  handleStopModeration!: (streamId: string, title: string | null) => Promise<void>

  constructor() {
    super()
    this.handleRefresh = this._handleRefresh.bind(this)
    this.handleOpenQna = this._handleOpenQna.bind(this)
    this.handleOpenRules = this._handleOpenRules.bind(this)
    this.handleStartModeration = this._handleStartModeration.bind(this)
    this.handleStopModeration = this._handleStopModeration.bind(this)
  }

  async created() {
    this.syncFromStore()
    this.removeChannelObservers = [
      channelStore.observe('activeChannel', () => this.syncFromStore()),
      channelStore.observe('channels', () => this.syncFromStore()),
      channelStore.observe('backendHealth', () => this.syncFromStore()),
      channelStore.observe('streams', () => this.syncFromStore()),
      channelStore.observe('streamsLoading', () => this.syncFromStore()),
      channelStore.observe('streamsLoaded', () => this.syncFromStore()),
      channelStore.observe('streamsError', () => this.syncFromStore()),
      channelStore.observe('streamsFetchedAt', () => this.syncFromStore()),
      channelStore.observe('moderatedStreamId', () => this.syncFromStore()),
      channelStore.observe('moderationRuntimeStartedAt', () => this.syncFromStore()),
      channelStore.observe('moderationRuntimeLoading', () => this.syncFromStore())
    ]

    const active = channelStore.channelId
    if (active) {
      this.lastLoadedChannel = active
      if (channelStore.streamsChannelId === active && channelStore.streamsLoaded) {
        await this.refreshHealth()
      } else if (!channelStore.streamsLoading) {
        await this.loadDashboard(active)
      } else {
        await this.refreshHealth()
      }
    }
  }

  dispose() {
    for (const removeObserver of this.removeChannelObservers) {
      removeObserver()
    }
    super.dispose()
  }

  syncFromStore() {
    this.channelMeta = channelStore.activeChannelMeta
    this.backendHealth = channelStore.backendHealth
    this.streamsLoading = channelStore.streamsLoading
    this.streamsLoaded = channelStore.streamsLoaded
    this.streamsError = channelStore.streamsError
    this.streamsFetchedAt = channelStore.streamsFetchedAt
    this.activeStreams = channelStore.activeStreams
    this.scheduledStreams = channelStore.scheduledStreams
    this.visibleStreams = channelStore.visibleStreams
    this.moderatedStreamId = channelStore.moderatedStreamId
    this.runtimeStartedAt = channelStore.moderationRuntimeStartedAt
    this.runtimeLoading = channelStore.moderationRuntimeLoading
  }

  async refreshHealth() {
    await channelStore.checkHealth()
  }

  async loadDashboard(channelId: string, options: { refresh?: boolean } = {}) {
    if (!channelId) return
    this.lastLoadedChannel = channelId

    await Promise.all([
      this.refreshHealth(),
      channelStore.loadStreams(channelId, { refresh: options.refresh })
    ])
  }

  loadDataIfNeeded() {
    const active = channelStore.channelId
    if (active && active !== this.lastLoadedChannel && !channelStore.streamsLoading) {
      this.lastLoadedChannel = active
      if (channelStore.streamsChannelId === active && channelStore.streamsLoaded) {
        this.refreshHealth()
      } else if (!channelStore.streamsLoading) {
        this.loadDashboard(active)
      }
    }
  }

  async _handleRefresh() {
    this.syncing = true
    try {
      await this.loadDashboard(channelStore.channelId, { refresh: true })
    } finally {
      this.syncing = false
    }
  }

  _handleQnaClick() {
    router.push('/qna')
  }

  _handleOpenQna() {
    router.push('/qna')
  }

  _handleOpenRules() {
    router.push('/moderation')
  }

  async _handleStartModeration(streamId: string, title: string | null) {
    if (channelStore.moderationRuntimeLoading || channelStore.moderatedStreamId === streamId) return

    try {
      await channelStore.startModeration(streamId)
      showSuccessToast({
        title: 'Moderation Started',
        description: title
          ? `Live moderation is now running for "${title}".`
          : 'Live moderation is now running for this stream.'
      })
    } catch (error: any) {
      showErrorToast({
        title: 'Start Failed',
        description: error?.message || 'Unable to start live moderation.'
      })
    }
  }

  async _handleStopModeration(streamId: string, title: string | null) {
    if (channelStore.moderationRuntimeLoading || channelStore.moderatedStreamId !== streamId) return

    try {
      await channelStore.stopModeration()
      showSuccessToast({
        title: 'Moderation Stopped',
        description: title
          ? `Live moderation stopped for "${title}".`
          : 'Live moderation stopped for this stream.'
      })
    } catch (error: any) {
      showErrorToast({
        title: 'Stop Failed',
        description: error?.message || 'Unable to stop live moderation.'
      })
    }
  }

  get hasVisibleStreams() {
    return this.visibleStreams.length > 0
  }

  get healthLabel() {
    const healthStatus = this.backendHealth
    return healthStatus === 'ok'
      ? 'API online'
      : healthStatus === 'loading'
        ? 'Checking API'
        : healthStatus === 'error'
          ? 'API unavailable'
          : 'API not checked'
  }

  get healthClass() {
    const healthStatus = this.backendHealth
    return healthStatus === 'ok'
      ? 'status-pill status-pill-ok'
      : healthStatus === 'error'
        ? 'status-pill status-pill-error'
        : 'status-pill status-pill-muted'
  }

  get streamLabel() {
    const streamStatus =
      this.streamsLoading
        ? 'loading'
        : this.streamsError
          ? 'error'
          : !this.streamsLoaded
            ? 'unknown'
            : this.activeStreams.length > 0
              ? 'live'
              : this.scheduledStreams.length > 0
                ? 'scheduled'
                : 'empty'
    return streamStatus === 'live'
      ? `${this.activeStreams.length} live`
      : streamStatus === 'scheduled'
        ? `${this.scheduledStreams.length} scheduled`
        : streamStatus === 'loading'
          ? 'Checking streams'
          : streamStatus === 'error'
            ? 'Stream check failed'
            : streamStatus === 'empty'
              ? 'No streams'
              : 'Streams not checked'
  }

  get streamClass() {
    const streamStatus =
      this.streamsLoading
        ? 'loading'
        : this.streamsError
          ? 'error'
          : !this.streamsLoaded
            ? 'unknown'
            : this.activeStreams.length > 0
              ? 'live'
              : this.scheduledStreams.length > 0
                ? 'scheduled'
                : 'empty'
    return streamStatus === 'live'
      ? 'status-pill status-pill-live'
      : streamStatus === 'error'
        ? 'status-pill status-pill-error'
        : 'status-pill status-pill-muted'
  }

  template() {
    this.loadDataIfNeeded()

    return (
      <div class="dashboard-page">
        <div class="page-header">
          <div class="min-w-0">
            <p class="page-kicker">Dashboard</p>
            <h1 class="page-title">Live stream control</h1>
            <p class="page-description">
              Monitor the streams that need moderation attention and jump into common setup tasks.
            </p>
          </div>

          <div class="header-actions">
            <span class={this.healthClass}>{this.healthLabel}</span>
            <span class={this.streamClass}>{this.streamLabel}</span>
            <Button variant="outline" size="sm" click={this.handleRefresh} disabled={this.syncing || this.streamsLoading}>
              {this.syncing || this.streamsLoading ? 'Syncing' : 'Sync Data'}
            </Button>
          </div>
        </div>

        {this.channelMeta && (
          <section class="channel-strip">
            {this.channelMeta.thumbnail && (
              <img src={this.channelMeta.thumbnail} alt={this.channelMeta.name} class="h-11 w-11 rounded-md object-cover" />
            )}
            <div class="min-w-0">
              <div class="text-sm font-semibold text-slate-100 truncate">{this.channelMeta.name}</div>
              {this.channelMeta.handle && <div class="text-sm text-slate-500 truncate">{this.channelMeta.handle}</div>}
            </div>
            <div class="ml-auto text-xs text-slate-500">{formatSyncTime(this.streamsFetchedAt)}</div>
          </section>
        )}

        <section class="grid gap-5 xl:grid-cols-[1fr_360px]">
          <Card class="panel-card">
            <CardHeader class="panel-header">
              <div>
                <CardTitle class="text-lg">Active and scheduled streams</CardTitle>
                <p class="mt-1 text-sm text-slate-500">Only streams that can need moderation are shown here.</p>
              </div>
            </CardHeader>
            <CardContent>
              {channelStore.hasVisibleStreams && (
                <div class="space-y-3">
                  {this.streamsLoading && (
                    <div class="stream-empty py-3">
                      <div class="loading-mark"></div>
                      <p>Refreshing stream data...</p>
                    </div>
                  )}

                  {channelStore.visibleStreams.map((stream) => (
                      <div key={stream.id} class="stream-card">
                        <div class="flex items-start gap-4">
                          <div class="min-w-0 flex-1">
                            <div class="flex items-center gap-2">
                              <Badge variant={stream.status === 'live' ? 'destructive' : 'secondary'} class={stream.status === 'live' ? 'status-badge-live' : 'status-badge-upcoming'}>
                                {stream.status === 'live' ? 'Live now' : 'Scheduled'}
                              </Badge>
                              <span class="text-xs text-slate-500 uppercase tracking-wide">{stream.platform}</span>
                            </div>
                            <h3 class="mt-3 text-base font-semibold text-slate-100 leading-snug truncate" title={stream.title || 'Untitled stream'}>
                              {stream.title || 'Untitled stream'}
                            </h3>
                            <p class="mt-1 text-sm text-slate-400">
                              {stream.status === 'live' ? 'Started' : 'Starts'} {formatStartTime(stream.startsAt)}
                            </p>
                            {stream.status === 'live' && stream.viewerCount !== null && (
                              <p class="mt-1 text-sm font-medium text-slate-300">
                                {stream.viewerCount.toLocaleString()} watching
                              </p>
                            )}
                            {stream.status === 'live' && this.moderatedStreamId === stream.id && (
                              <p class="mt-2 text-xs font-medium uppercase tracking-wide text-emerald-300">
                                {formatRuntimeTime(this.runtimeStartedAt)}
                              </p>
                            )}
                          </div>
                          {stream.status === 'live' && (
                            <div class="flex shrink-0 items-center">
                              {this.runtimeLoading && (
                                <button type="button" class={loadingButtonClass} disabled>
                                  Working...
                                </button>
                              )}
                              {!this.runtimeLoading && this.moderatedStreamId === stream.id && (
                                <button
                                  type="button"
                                  class={stopButtonClass}
                                  click={() => this.handleStopModeration(stream.id, stream.title)}
                                >
                                  Stop Moderation
                                </button>
                              )}
                              {!this.runtimeLoading && this.moderatedStreamId !== stream.id && (
                                <button
                                  type="button"
                                  class={startButtonClass}
                                  click={() => this.handleStartModeration(stream.id, stream.title)}
                                >
                                  Start Moderation
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              )}

              {!this.hasVisibleStreams && this.streamsLoading && (
                <div class="stream-empty">
                  <div class="loading-mark"></div>
                  <p>Checking your live stream schedule...</p>
                </div>
              )}

              {!this.hasVisibleStreams && !this.streamsLoading && this.streamsError && (
                <div class="stream-empty stream-empty-error">
                  <p>{this.streamsError}</p>
                  <Button variant="outline" size="sm" click={this.handleRefresh}>Try Again</Button>
                </div>
              )}

              {!this.hasVisibleStreams && !this.streamsLoading && !this.streamsError && !this.streamsLoaded && (
                <div class="stream-empty">
                  <p class="font-medium text-slate-200">Streams are not synced yet</p>
                  <p class="mt-1 text-sm text-slate-500">Use Sync Data when you want to spend YouTube quota on a fresh stream lookup.</p>
                </div>
              )}

              {!this.hasVisibleStreams && !this.streamsLoading && !this.streamsError && this.streamsLoaded && (
                <div class="stream-empty">
                  <p class="font-medium text-slate-200">No active or scheduled streams</p>
                  <p class="mt-1 text-sm text-slate-500">When a stream is live or scheduled, it will appear here.</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card class="panel-card">
            <CardHeader class="panel-header">
              <CardTitle class="text-lg">Quick actions</CardTitle>
            </CardHeader>
            <CardContent class="space-y-3">
              <button type="button" click={this.handleOpenQna} class="action-row">
                <span>
                  <strong>Q&A replies</strong>
                  <small>Manage answers for repeated chat questions.</small>
                </span>
                <span aria-hidden="true">Open</span>
              </button>

              <button type="button" click={this.handleOpenRules} class="action-row">
                <span>
                  <strong>Moderation rules</strong>
                  <small>Review ban and timeout behavior.</small>
                </span>
                <span aria-hidden="true">Open</span>
              </button>
            </CardContent>
          </Card>
        </section>
      </div>
    )
  }
}
