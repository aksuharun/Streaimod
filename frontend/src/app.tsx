import {
  startTransition,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useState,
  useSyncExternalStore,
  type DragEvent,
  type FormEvent,
  type ReactNode
} from 'react'

import { api, ApiError, type AuthChannel, type AuthSession, type ModerationCategory, type ModerationCategoryType, type QnaEntry, type StreamSummary } from './services/api'
import { buildBackendUrl } from './services/backend-url'
import {
  clearToasts,
  dismissToast,
  getToasts,
  showErrorToast,
  showSuccessToast,
  subscribeToasts,
  type ToastItem
} from './services/toast'

type AppRoute = '/' | '/onboarding' | '/dashboard' | '/qna' | '/moderation'
type HealthStatus = 'ok' | 'error' | 'loading' | 'unknown'
type StreamStatusLabel = 'loading' | 'live' | 'scheduled' | 'empty' | 'error' | 'unknown'
type BoardColumn = 'catalog' | ModerationCategoryType

interface QnaDraft {
  question: string
  answer: string
  enabled: boolean
}

const appLinks: Array<{ href: AppRoute; label: string }> = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/qna', label: 'Q&A Rules' },
  { href: '/moderation', label: 'Moderation Rules' }
]

const featureCards = [
  {
    title: 'Live stream control center',
    description: 'See your active and scheduled streams, inspect system health, and start or stop moderation from one command surface.'
  },
  {
    title: 'Trusted Q&A replies',
    description: 'Store exact answers for repeated viewer questions so the agent replies only when a configured match exists.'
  },
  {
    title: 'Policy-based moderation lanes',
    description: 'Assign canonical safety categories into timeout or ban lanes and keep enforcement decisions understandable.'
  },
  {
    title: 'Channel-aware automation',
    description: 'Every action stays scoped to the connected creator channel, with independent master switches for Q&A and moderation.'
  }
]

const workflowSteps = [
  'Message captured with channel context',
  'Approved rules retrieved for the active channel',
  'Prompt rendered with trusted entries and policy lanes',
  'Agent returns a structured decision',
  'Only safe, explicit actions are executed'
]

function trimPathname(pathname: string): AppRoute | string {
  if (pathname === '') {
    return '/'
  }

  return pathname.endsWith('/') && pathname !== '/'
    ? pathname.slice(0, -1)
    : pathname
}

function initials(value: string) {
  return value
    .split(/\s+/)
    .map((part) => part[0] || '')
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

function formatStartTime(value: string | null) {
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

function formatTimeAgoLabel(value: string | null, prefix: string, fallback: string) {
  if (!value) return fallback

  try {
    return `${prefix} ${new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit'
    }).format(new Date(value))}`
  } catch {
    return fallback
  }
}

function healthLabel(status: HealthStatus) {
  if (status === 'ok') return 'API online'
  if (status === 'loading') return 'Checking API'
  if (status === 'error') return 'API unavailable'
  return 'API not checked'
}

function streamLabel(
  streamState: StreamStatusLabel,
  activeCount: number,
  scheduledCount: number
) {
  if (streamState === 'live') return `${activeCount} live`
  if (streamState === 'scheduled') return `${scheduledCount} scheduled`
  if (streamState === 'loading') return 'Checking streams'
  if (streamState === 'error') return 'Stream check failed'
  if (streamState === 'empty') return 'No streams'
  return 'Streams not checked'
}

function toneClass(tone: ToastItem['tone']) {
  if (tone === 'success') return 'toast-success'
  if (tone === 'error') return 'toast-error'
  if (tone === 'loading') return 'toast-loading'
  return 'toast-info'
}

function isProtectedRoute(path: string) {
  return path === '/dashboard' || path === '/qna' || path === '/moderation'
}

function ToastViewport() {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts, getToasts)

  return (
    <div className="toast-viewport" aria-live="polite" aria-atomic="true">
      {toasts.map((toast) => (
        <article key={toast.id} className={`toast-card ${toneClass(toast.tone)}`}>
          <div>
            <strong>{toast.title}</strong>
            {toast.description && <p>{toast.description}</p>}
          </div>
          <button
            type="button"
            className="toast-dismiss"
            aria-label="Dismiss notification"
            onClick={() => dismissToast(toast.id)}
          >
            ×
          </button>
        </article>
      ))}
    </div>
  )
}

function StatusSwitch(props: {
  checked: boolean
  disabled?: boolean
  activeLabel: string
  inactiveLabel: string
  onToggle: () => void
}) {
  const label = props.checked ? props.activeLabel : props.inactiveLabel

  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      disabled={props.disabled}
      className={`status-switch ${props.checked ? 'status-switch-on' : 'status-switch-off'}`}
      onClick={props.onToggle}
    >
      <span className="status-switch-track">
        <span className="status-switch-thumb" />
      </span>
      <span>{label}</span>
    </button>
  )
}

function Modal(props: {
  title: string
  description: string
  children: ReactNode
  onClose: () => void
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        props.onClose()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [props])

  return (
    <div className="modal-shell" role="dialog" aria-modal="true" aria-label={props.title}>
      <div className="modal-backdrop" onClick={props.onClose} />
      <div className="modal-card">
        <div className="modal-header">
          <div>
            <p className="eyebrow">Editor</p>
            <h2>{props.title}</h2>
            <p>{props.description}</p>
          </div>
          <button type="button" className="ghost-button" onClick={props.onClose}>
            Close
          </button>
        </div>
        {props.children}
      </div>
    </div>
  )
}

function EmptyPanel(props: {
  title: string
  description: string
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <div className="empty-panel">
      <div className="empty-icon">◎</div>
      <h3>{props.title}</h3>
      <p>{props.description}</p>
      {props.actionLabel && props.onAction && (
        <button type="button" className="secondary-button" onClick={props.onAction}>
          {props.actionLabel}
        </button>
      )}
    </div>
  )
}

function AppShell(props: {
  currentPath: string
  channel: AuthChannel | null
  onNavigate: (path: AppRoute) => void
  onLogout: () => Promise<void>
  busy: boolean
  children: ReactNode
}) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <button type="button" className="brand-block" onClick={() => props.onNavigate('/dashboard')}>
          <span className="brand-mark">M</span>
          <span>
            <strong>AI Moderator</strong>
            <small>Broadcast control</small>
          </span>
        </button>

        <section className="sidebar-panel">
          <p className="sidebar-label">Connected channel</p>
          {props.channel ? (
            <div className="channel-chip">
              {props.channel.thumbnail ? (
                <img src={props.channel.thumbnail} alt={props.channel.name} />
              ) : (
                <span className="avatar-fallback">{initials(props.channel.name)}</span>
              )}
              <div>
                <strong>{props.channel.name}</strong>
                {props.channel.handle && <small>{props.channel.handle}</small>}
              </div>
            </div>
          ) : (
            <div className="sidebar-note">No active channel</div>
          )}
        </section>

        <nav className="sidebar-nav" aria-label="Application navigation">
          {appLinks.map((link) => (
            <button
              key={link.href}
              type="button"
              className={`nav-link ${props.currentPath === link.href ? 'nav-link-active' : ''}`}
              onClick={() => props.onNavigate(link.href)}
            >
              {link.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button
            type="button"
            className="secondary-button full-width"
            disabled={props.busy}
            onClick={() => void props.onLogout()}
          >
            {props.busy ? 'Signing out...' : 'Sign out'}
          </button>
          <p>React rebuild · YouTube operations first</p>
        </div>
      </aside>

      <main className="main-content">{props.children}</main>
    </div>
  )
}

function LandingScreen(props: { onNavigate: (path: AppRoute) => void }) {
  return (
    <div className="landing-root">
      <section className="landing-hero">
        <header className="landing-nav">
          <div className="brand-inline">
            <span className="brand-mark">M</span>
            <div>
              <strong>AI Moderator</strong>
              <small>Livestream operations</small>
            </div>
          </div>

          <div className="landing-nav-links">
            <button type="button" onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}>
              Features
            </button>
            <button type="button" onClick={() => document.getElementById('workflow')?.scrollIntoView({ behavior: 'smooth' })}>
              Workflow
            </button>
            <button type="button" onClick={() => document.getElementById('roadmap')?.scrollIntoView({ behavior: 'smooth' })}>
              Roadmap
            </button>
          </div>

          <button type="button" className="primary-button" onClick={() => props.onNavigate('/onboarding')}>
            Connect channel
          </button>
        </header>

        <div className="hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">AI agents for high-velocity live chat</p>
            <h1>Run livestream chat like a control room, not a comment section.</h1>
            <p className="hero-text">
              AI Moderator gives creators one sharp surface for stream readiness, trusted Q&A replies,
              and explicit moderation lanes. No vague autonomy. Only configured actions.
            </p>

            <div className="hero-actions">
              <button type="button" className="primary-button" onClick={() => props.onNavigate('/onboarding')}>
                Start setup
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => document.getElementById('workflow')?.scrollIntoView({ behavior: 'smooth' })}
              >
                See workflow
              </button>
            </div>

            <div className="trust-row">
              <span>Google OAuth</span>
              <span>YouTube live streams</span>
              <span>Structured AI decisions</span>
            </div>
          </div>

          <div className="broadcast-card">
            <div className="broadcast-head">
              <strong>Live chat signal</strong>
              <span>12,408 watching</span>
            </div>
            <div className="chat-stack">
              <div className="chat-message muted">
                <span className="chat-avatar">K</span>
                <p><strong>Kaan</strong> Will the replay be posted right after the stream?</p>
              </div>
              <div className="chat-message question">
                <span className="chat-avatar">A</span>
                <p><strong>Ayse</strong> What time does the workshop replay go live?</p>
              </div>
              <div className="chat-message answer">
                <span className="ai-badge">AI</span>
                <p><strong>AI Moderator</strong> The replay goes live about 20 minutes after the stream ends. We pin the link in chat as soon as it is ready.</p>
              </div>
              <div className="chat-signal">
                <span>Configured answer matched</span>
                <strong>SEND_ANSWER</strong>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="landing-section">
        <div className="section-heading">
          <p className="eyebrow">Supported now</p>
          <h2>Built for creators who need clarity while chat moves fast.</h2>
        </div>
        <div className="feature-grid">
          {featureCards.map((card) => (
            <article key={card.title} className="feature-card">
              <span className="feature-index">{card.title.split(' ')[0]}</span>
              <h3>{card.title}</h3>
              <p>{card.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="workflow" className="landing-section workflow-section">
        <div className="section-heading">
          <p className="eyebrow">Q&A decision path</p>
          <h2>Every automated reply passes through an explicit gate.</h2>
        </div>
        <div className="workflow-rail">
          {workflowSteps.map((step, index) => (
            <article key={step} className="workflow-step">
              <span>{String(index + 1).padStart(2, '0')}</span>
              <p>{step}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="roadmap" className="landing-section roadmap-card">
        <div>
          <p className="eyebrow">Coming next</p>
          <h2>Audience engagement agents that wake up a quiet stream.</h2>
        </div>
        <ul>
          <li>Automated polls based on stream context</li>
          <li>Retention-aware prompts for slow moments</li>
          <li>Post-stream insight on moderation load and repeated questions</li>
        </ul>
      </section>
    </div>
  )
}

function OnboardingScreen(props: {
  authenticated: boolean
  onGoogleLogin: () => void
  authenticating: boolean
}) {
  const error = new URLSearchParams(window.location.search).get('error')

  return (
    <div className="onboarding-root">
      <div className="onboarding-panel">
        <div className="brand-inline centered">
          <span className="brand-mark">M</span>
          <div>
            <strong>AI Moderator</strong>
            <small>Creator setup</small>
          </div>
        </div>

        <div className="onboarding-copy">
          <p className="eyebrow">Authentication</p>
          <h1>Connect Google and load your YouTube channel identity.</h1>
          <p>
            We use Google OAuth to restore your creator channel, remember its moderation settings,
            and run YouTube chat automation without manual channel ID entry.
          </p>
        </div>

        {error && <div className="error-banner">{error}</div>}
        {props.authenticated && <div className="success-banner">Session restored. Redirecting to your dashboard.</div>}

        <button
          type="button"
          className="primary-button giant-button"
          disabled={props.authenticating}
          onClick={props.onGoogleLogin}
        >
          {props.authenticating ? 'Redirecting to Google...' : 'Continue with Google'}
        </button>

        <p className="helper-text">
          Requires backend Google OAuth configuration and an available MongoDB connection.
        </p>
      </div>
    </div>
  )
}

function DashboardPage(props: {
  activeChannel: AuthChannel
  onNavigate: (path: AppRoute) => void
}) {
  const [health, setHealth] = useState<HealthStatus>('unknown')
  const [streams, setStreams] = useState<StreamSummary[]>([])
  const [streamsLoading, setStreamsLoading] = useState(false)
  const [streamsLoaded, setStreamsLoaded] = useState(false)
  const [streamsError, setStreamsError] = useState<string | null>(null)
  const [streamsFetchedAt, setStreamsFetchedAt] = useState<string | null>(null)
  const [runtimeLoading, setRuntimeLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [moderatedStreamId, setModeratedStreamId] = useState<string | null>(null)
  const [runtimeStartedAt, setRuntimeStartedAt] = useState<string | null>(null)

  const activeStreams = streams.filter((stream) => stream.status === 'live')
  const scheduledStreams = streams.filter((stream) => stream.status === 'upcoming')
  const visibleStreams = [...activeStreams, ...scheduledStreams]

  let streamState: StreamStatusLabel = 'unknown'
  if (streamsLoading) streamState = 'loading'
  else if (streamsError) streamState = 'error'
  else if (!streamsLoaded) streamState = 'unknown'
  else if (activeStreams.length > 0) streamState = 'live'
  else if (scheduledStreams.length > 0) streamState = 'scheduled'
  else streamState = 'empty'

  const checkHealth = useEffectEvent(async () => {
    setHealth('loading')

    try {
      const response = await fetch(buildBackendUrl('/health'), {
        credentials: 'include'
      })
      if (!response.ok) {
        setHealth('error')
        return
      }

      const data = (await response.json()) as { status?: string }
      setHealth(data.status === 'ok' ? 'ok' : 'error')
    } catch {
      setHealth('error')
    }
  })

  const loadStreams = useEffectEvent(async (refresh = false) => {
    setStreamsLoading(true)
    setStreamsError(null)

    try {
      const [overview, runtime] = await Promise.all([
        api.getStreamOverview(props.activeChannel.channelId, { refresh }),
        api.getStreamRuntimeStatus(props.activeChannel.channelId)
      ])

      setStreams([...overview.active, ...overview.scheduled])
      setStreamsFetchedAt(overview.fetchedAt)
      setModeratedStreamId(runtime.streamId)
      setRuntimeStartedAt(runtime.startedAt)
      setStreamsLoaded(true)
      setStreamsError(overview.warning ?? null)
    } catch (error) {
      setStreams([])
      setStreamsLoaded(true)
      setStreamsError(error instanceof Error ? error.message : 'Unable to check live streams')
      setModeratedStreamId(null)
      setRuntimeStartedAt(null)
    } finally {
      setStreamsLoading(false)
    }
  })

  useEffect(() => {
    void checkHealth()
    void loadStreams(false)
  }, [checkHealth, loadStreams, props.activeChannel.channelId])

  async function refreshAll() {
    setSyncing(true)
    try {
      await Promise.all([checkHealth(), loadStreams(true)])
    } finally {
      setSyncing(false)
    }
  }

  async function startModeration(stream: StreamSummary) {
    if (runtimeLoading) return

    setRuntimeLoading(true)
    try {
      const status = await api.startStreamRuntime({
        channelId: props.activeChannel.channelId,
        streamId: stream.id
      })
      setModeratedStreamId(status.streamId)
      setRuntimeStartedAt(status.startedAt)
      showSuccessToast({
        title: 'Moderation started',
        description: stream.title
          ? `Live moderation is now running for "${stream.title}".`
          : 'Live moderation is now running for this stream.'
      })
    } catch (error) {
      showErrorToast({
        title: 'Start failed',
        description: error instanceof Error ? error.message : 'Unable to start live moderation.'
      })
    } finally {
      setRuntimeLoading(false)
    }
  }

  async function stopModeration(stream: StreamSummary) {
    if (runtimeLoading) return

    setRuntimeLoading(true)
    try {
      const status = await api.stopStreamRuntime({
        channelId: props.activeChannel.channelId
      })
      setModeratedStreamId(status.streamId)
      setRuntimeStartedAt(status.startedAt)
      showSuccessToast({
        title: 'Moderation stopped',
        description: stream.title
          ? `Live moderation stopped for "${stream.title}".`
          : 'Live moderation stopped for this stream.'
      })
    } catch (error) {
      showErrorToast({
        title: 'Stop failed',
        description: error instanceof Error ? error.message : 'Unable to stop live moderation.'
      })
    } finally {
      setRuntimeLoading(false)
    }
  }

  return (
    <div className="page-wrap">
      <header className="page-header">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h1>Live stream control</h1>
          <p className="page-text">
            Watch the streams that need attention, confirm system health, and launch moderation from one screen.
          </p>
        </div>
        <div className="header-actions">
          <span className={`status-pill ${health}`}>{healthLabel(health)}</span>
          <span className={`status-pill ${streamState}`}>{streamLabel(streamState, activeStreams.length, scheduledStreams.length)}</span>
          <button
            type="button"
            className="secondary-button"
            disabled={syncing || streamsLoading}
            onClick={() => void refreshAll()}
          >
            {syncing || streamsLoading ? 'Syncing...' : 'Sync data'}
          </button>
        </div>
      </header>

      <section className="channel-banner">
        <div className="channel-chip wide">
          {props.activeChannel.thumbnail ? (
            <img src={props.activeChannel.thumbnail} alt={props.activeChannel.name} />
          ) : (
            <span className="avatar-fallback">{initials(props.activeChannel.name)}</span>
          )}
          <div>
            <strong>{props.activeChannel.name}</strong>
            {props.activeChannel.handle && <small>{props.activeChannel.handle}</small>}
          </div>
        </div>
        <span>{formatTimeAgoLabel(streamsFetchedAt, 'Synced', 'Not synced yet')}</span>
      </section>

      <section className="dashboard-grid">
        <article className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Queue</p>
              <h2>Active and scheduled streams</h2>
              <p>Only streams that can require moderation are surfaced here.</p>
            </div>
          </div>

          {visibleStreams.length > 0 && (
            <div className="stream-list">
              {visibleStreams.map((stream) => {
                const live = stream.status === 'live'
                const managing = moderatedStreamId === stream.id

                return (
                  <article key={stream.id} className="stream-card">
                    <div className="stream-meta">
                      <div className="stream-topline">
                        <span className={`badge ${live ? 'badge-live' : 'badge-scheduled'}`}>
                          {live ? 'Live now' : 'Scheduled'}
                        </span>
                        <span className="platform-tag">{stream.platform}</span>
                      </div>
                      <h3>{stream.title || 'Untitled stream'}</h3>
                      <p>{live ? 'Started' : 'Starts'} {formatStartTime(stream.startsAt)}</p>
                      {live && stream.viewerCount !== null && (
                        <strong className="metric-line">{stream.viewerCount.toLocaleString()} watching</strong>
                      )}
                      {live && managing && (
                        <span className="runtime-line">
                          {formatTimeAgoLabel(runtimeStartedAt, 'Running since', 'Running')}
                        </span>
                      )}
                    </div>

                    {live && (
                      <div className="stream-actions">
                        {runtimeLoading ? (
                          <button type="button" className="secondary-button" disabled>
                            Working...
                          </button>
                        ) : managing ? (
                          <button type="button" className="danger-button" onClick={() => void stopModeration(stream)}>
                            Stop moderation
                          </button>
                        ) : (
                          <button type="button" className="success-button" onClick={() => void startModeration(stream)}>
                            Start moderation
                          </button>
                        )}
                      </div>
                    )}
                  </article>
                )
              })}
            </div>
          )}

          {visibleStreams.length === 0 && streamsLoading && (
            <EmptyPanel
              title="Checking your stream queue"
              description="Refreshing live and scheduled stream data from YouTube."
            />
          )}

          {visibleStreams.length === 0 && !streamsLoading && streamsError && (
            <EmptyPanel
              title="Stream lookup failed"
              description={streamsError}
              actionLabel="Try again"
              onAction={() => void refreshAll()}
            />
          )}

          {visibleStreams.length === 0 && !streamsLoading && !streamsError && !streamsLoaded && (
            <EmptyPanel
              title="Streams are not synced yet"
              description="Use Sync data when you want to spend YouTube quota on a fresh stream lookup."
            />
          )}

          {visibleStreams.length === 0 && !streamsLoading && !streamsError && streamsLoaded && (
            <EmptyPanel
              title="No active or scheduled streams"
              description="When a stream is live or scheduled, it will appear here automatically."
            />
          )}
        </article>

        <aside className="panel quick-panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Shortcuts</p>
              <h2>Quick actions</h2>
            </div>
          </div>

          <button type="button" className="action-row" onClick={() => props.onNavigate('/qna')}>
            <span>
              <strong>Q&A replies</strong>
              <small>Manage trusted answers for repeated viewer questions.</small>
            </span>
            <em>Open</em>
          </button>

          <button type="button" className="action-row" onClick={() => props.onNavigate('/moderation')}>
            <span>
              <strong>Moderation rules</strong>
              <small>Adjust category routing across timeout and ban agents.</small>
            </span>
            <em>Open</em>
          </button>
        </aside>
      </section>
    </div>
  )
}

function QnaPage(props: {
  activeChannel: AuthChannel
  channelSettingsUpdating: boolean
  onUpdateChannelSettings: (data: { qnaEnabled?: boolean; moderationEnabled?: boolean }) => Promise<void>
}) {
  const [entries, setEntries] = useState<QnaEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingEntry, setEditingEntry] = useState<QnaEntry | null>(null)
  const [draft, setDraft] = useState<QnaDraft>({
    question: '',
    answer: '',
    enabled: true
  })
  const [saving, setSaving] = useState(false)
  const [togglingIds, setTogglingIds] = useState<Record<string, boolean>>({})
  const [deletingIds, setDeletingIds] = useState<Record<string, boolean>>({})

  const loadEntries = useEffectEvent(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await api.getQnaEntries(props.activeChannel.channelId)
      setEntries(result)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load Q&A entries')
    } finally {
      setLoading(false)
    }
  })

  useEffect(() => {
    void loadEntries()
  }, [loadEntries, props.activeChannel.channelId])

  const filteredEntries = deferredSearch
    ? entries.filter((entry) => {
        const needle = deferredSearch.toLowerCase()
        return (
          entry.question.toLowerCase().includes(needle) ||
          entry.answer.toLowerCase().includes(needle)
        )
      })
    : entries

  function openCreateModal() {
    setEditingEntry(null)
    setDraft({ question: '', answer: '', enabled: true })
    setModalOpen(true)
  }

  function openEditModal(entry: QnaEntry) {
    setEditingEntry(entry)
    setDraft({
      question: entry.question,
      answer: entry.answer,
      enabled: entry.enabled
    })
    setModalOpen(true)
  }

  async function submitRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const question = draft.question.trim()
    const answer = draft.answer.trim()
    if (!question || !answer) {
      showErrorToast({
        title: 'Validation error',
        description: 'Question and answer are both required.'
      })
      return
    }

    setSaving(true)
    try {
      if (editingEntry) {
        const updated = await api.updateQnaEntry(editingEntry.id, {
          question,
          answer,
          enabled: draft.enabled
        })
        setEntries((current) => current.map((entry) => entry.id === updated.id ? updated : entry))
        showSuccessToast({
          title: 'Q&A updated',
          description: 'The response rule has been updated.'
        })
      } else {
        const created = await api.createQnaEntry({
          channelId: props.activeChannel.channelId,
          question,
          answer,
          enabled: draft.enabled
        })
        setEntries((current) => [...current, created])
        showSuccessToast({
          title: 'Q&A created',
          description: 'The response rule is now available to the agent.'
        })
      }

      setModalOpen(false)
      setEditingEntry(null)
    } catch (saveError) {
      showErrorToast({
        title: 'Save failed',
        description: saveError instanceof Error ? saveError.message : 'Failed to save Q&A entry.'
      })
    } finally {
      setSaving(false)
    }
  }

  async function toggleRule(entry: QnaEntry) {
    setTogglingIds((current) => ({ ...current, [entry.id]: true }))
    try {
      const updated = await api.updateQnaEntry(entry.id, {
        enabled: !entry.enabled
      })
      setEntries((current) => current.map((item) => item.id === updated.id ? updated : item))
      showSuccessToast({
        title: updated.enabled ? 'Rule enabled' : 'Rule paused',
        description: `"${updated.question}" is now ${updated.enabled ? 'active' : 'paused'}.`
      })
    } catch (toggleError) {
      showErrorToast({
        title: 'Toggle failed',
        description: toggleError instanceof Error ? toggleError.message : 'Failed to update rule status.'
      })
    } finally {
      setTogglingIds((current) => ({ ...current, [entry.id]: false }))
    }
  }

  async function deleteRule(entry: QnaEntry) {
    if (!window.confirm(`Delete Q&A rule "${entry.question}"?`)) {
      return
    }

    setDeletingIds((current) => ({ ...current, [entry.id]: true }))
    try {
      await api.deleteQnaEntry(entry.id)
      setEntries((current) => current.filter((item) => item.id !== entry.id))
      showSuccessToast({
        title: 'Rule deleted',
        description: 'The Q&A response rule has been permanently removed.'
      })
    } catch (deleteError) {
      showErrorToast({
        title: 'Delete failed',
        description: deleteError instanceof Error ? deleteError.message : 'Failed to delete the rule.'
      })
    } finally {
      setDeletingIds((current) => ({ ...current, [entry.id]: false }))
    }
  }

  async function toggleAgent() {
    try {
      await props.onUpdateChannelSettings({ qnaEnabled: !props.activeChannel.qnaEnabled })
      showSuccessToast({
        title: !props.activeChannel.qnaEnabled ? 'Q&A agent enabled' : 'Q&A agent paused',
        description: !props.activeChannel.qnaEnabled
          ? 'Configured Q&A rules will answer matching live chat again.'
          : 'Configured rules remain stored, but automatic replies are paused.'
      })
    } catch (toggleError) {
      showErrorToast({
        title: 'Agent update failed',
        description: toggleError instanceof Error ? toggleError.message : 'Failed to update the Q&A agent setting.'
      })
    }
  }

  return (
    <div className="page-wrap">
      <header className="page-header">
        <div>
          <p className="eyebrow">Automated replies</p>
          <h1>Q&A Rules</h1>
          <p className="page-text">
            Store exact replies for repeated viewer questions. The agent stays silent unless a configured trusted match exists.
          </p>
        </div>
        <button type="button" className="primary-button" onClick={openCreateModal}>
          Add response rule
        </button>
      </header>

      <section className="panel agent-banner">
        <div>
          <p className="eyebrow">Channel switch</p>
          <h2>Q&A agent status</h2>
          <p>
            {props.activeChannel.qnaEnabled
              ? 'The live Q&A agent is enabled and can answer matching viewer questions.'
              : 'The live Q&A agent is paused. Saved rules stay intact, but automatic replies are disabled.'}
          </p>
        </div>
        <StatusSwitch
          checked={props.activeChannel.qnaEnabled}
          disabled={props.channelSettingsUpdating}
          activeLabel={props.channelSettingsUpdating ? 'Saving...' : 'Enabled'}
          inactiveLabel={props.channelSettingsUpdating ? 'Saving...' : 'Paused'}
          onToggle={() => void toggleAgent()}
        />
      </section>

      {error && (
        <div className="error-banner inline-banner">
          <span>{error}</span>
          <button type="button" className="ghost-button" onClick={() => void loadEntries()}>
            Retry
          </button>
        </div>
      )}

      {loading && entries.length === 0 ? (
        <EmptyPanel
          title="Retrieving automated answers"
          description="Pulling the current Q&A rule set for this channel."
        />
      ) : entries.length === 0 ? (
        <EmptyPanel
          title="Initialize automated responses"
          description="This channel has no automated Q&A response rules configured yet."
          actionLabel="Add first rule"
          onAction={openCreateModal}
        />
      ) : (
        <section className="panel">
          <div className="table-toolbar">
            <input
              type="text"
              className="search-input"
              placeholder="Filter by question or answer keywords..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <span className="toolbar-count">
              Showing <strong>{filteredEntries.length}</strong> of {entries.length}
            </span>
          </div>

          {filteredEntries.length === 0 ? (
            <EmptyPanel
              title="No rules match this filter"
              description="Try a different keyword or clear the search query."
            />
          ) : (
            <div className="table-card">
              <table>
                <thead>
                  <tr>
                    <th>Question or keywords</th>
                    <th>Automated answer</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.map((entry) => (
                    <tr key={entry.id}>
                      <td>
                        <strong>{entry.question}</strong>
                      </td>
                      <td>{entry.answer}</td>
                      <td>
                        <StatusSwitch
                          checked={entry.enabled}
                          disabled={!!togglingIds[entry.id]}
                          activeLabel={togglingIds[entry.id] ? 'Saving...' : 'Active'}
                          inactiveLabel={togglingIds[entry.id] ? 'Saving...' : 'Paused'}
                          onToggle={() => void toggleRule(entry)}
                        />
                      </td>
                      <td>
                        <div className="table-actions">
                          <button type="button" className="ghost-button" onClick={() => openEditModal(entry)}>
                            Edit
                          </button>
                          <button
                            type="button"
                            className="danger-link"
                            disabled={!!deletingIds[entry.id]}
                            onClick={() => void deleteRule(entry)}
                          >
                            {deletingIds[entry.id] ? 'Deleting...' : 'Delete'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {modalOpen && (
        <Modal
          title={editingEntry ? 'Modify Q&A rule' : 'Add Q&A response rule'}
          description={editingEntry ? 'Update the trigger wording or stored answer.' : 'Create an exact answer for a repeated viewer question.'}
          onClose={() => {
            if (!saving) setModalOpen(false)
          }}
        >
          <form className="editor-form" onSubmit={(event) => void submitRule(event)}>
            <label>
              <span>Question or matching keywords</span>
              <textarea
                rows={3}
                value={draft.question}
                onChange={(event) => setDraft((current) => ({ ...current, question: event.target.value }))}
                placeholder="e.g. what time does the replay go live?"
              />
            </label>

            <label>
              <span>Automated answer</span>
              <textarea
                rows={5}
                value={draft.answer}
                onChange={(event) => setDraft((current) => ({ ...current, answer: event.target.value }))}
                placeholder="e.g. The replay goes live about 20 minutes after the stream ends."
              />
            </label>

            <div className="editor-toggle">
              <div>
                <strong>Enable response rule</strong>
                <p>If disabled, the rule stays stored but the agent will not use it.</p>
              </div>
              <StatusSwitch
                checked={draft.enabled}
                activeLabel="Active"
                inactiveLabel="Paused"
                onToggle={() => setDraft((current) => ({ ...current, enabled: !current.enabled }))}
              />
            </div>

            <div className="editor-actions">
              <button type="button" className="ghost-button" disabled={saving} onClick={() => setModalOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="primary-button" disabled={saving}>
                {saving ? 'Saving...' : editingEntry ? 'Save changes' : 'Create rule'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}

function ModerationPage(props: {
  activeChannel: AuthChannel
  channelSettingsUpdating: boolean
  onUpdateChannelSettings: (data: { qnaEnabled?: boolean; moderationEnabled?: boolean }) => Promise<void>
}) {
  const [catalog, setCatalog] = useState<Array<{ catalogId: string; label: string; definition: string }>>([])
  const [categories, setCategories] = useState<ModerationCategory[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draggingCatalogId, setDraggingCatalogId] = useState('')
  const [dragOverColumn, setDragOverColumn] = useState<BoardColumn | ''>('')
  const [movingIds, setMovingIds] = useState<Record<string, boolean>>({})
  const [togglingIds, setTogglingIds] = useState<Record<string, boolean>>({})

  const loadBoard = useEffectEvent(async () => {
    setLoading(true)
    setError(null)
    try {
      const [catalogEntries, assignedCategories] = await Promise.all([
        api.getCatalogEntries(),
        api.getCategories({ channelId: props.activeChannel.channelId })
      ])
      setCatalog(catalogEntries)
      setCategories(assignedCategories)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load moderation categories')
    } finally {
      setLoading(false)
    }
  })

  useEffect(() => {
    void loadBoard()
  }, [loadBoard, props.activeChannel.channelId])

  const boardItems = catalog.map((entry) => {
    const assigned = categories.find((category) => category.catalogId === entry.catalogId)
    return {
      catalogId: entry.catalogId,
      label: assigned?.label ?? entry.label,
      definition: assigned?.definition ?? entry.definition,
      type: assigned?.type ?? null,
      enabled: assigned?.enabled ?? false,
      categoryId: assigned?.id ?? null
    }
  })

  const categoryLane = boardItems.filter((item) => item.type === null)
  const timeoutLane = boardItems.filter((item) => item.type === 'timeout')
  const banLane = boardItems.filter((item) => item.type === 'ban')

  async function moveCard(catalogId: string, targetColumn: BoardColumn) {
    if (!catalogId || movingIds[catalogId]) return

    const existing = categories.find((category) => category.catalogId === catalogId)
    const catalogEntry = catalog.find((entry) => entry.catalogId === catalogId)
    setDragOverColumn('')
    setDraggingCatalogId('')

    if (!catalogEntry) {
      showErrorToast({
        title: 'Category missing',
        description: 'This category is not available in the moderation catalog.'
      })
      return
    }

    if (targetColumn === 'catalog') {
      if (!existing) return

      setMovingIds((current) => ({ ...current, [catalogId]: true }))
      try {
        await api.deleteCategory(existing.id)
        setCategories((current) => current.filter((category) => category.id !== existing.id))
        showSuccessToast({
          title: 'Category unassigned',
          description: `"${existing.label}" is back in the unassigned lane.`
        })
      } catch (moveError) {
        showErrorToast({
          title: 'Move failed',
          description: moveError instanceof Error ? moveError.message : 'Failed to remove this category from the agent.'
        })
      } finally {
        setMovingIds((current) => ({ ...current, [catalogId]: false }))
      }
      return
    }

    if (existing?.type === targetColumn) {
      return
    }

    setMovingIds((current) => ({ ...current, [catalogId]: true }))
    try {
      if (existing) {
        const updated = await api.updateCategory(existing.id, { type: targetColumn })
        setCategories((current) => current.map((category) => category.id === updated.id ? updated : category))
      } else {
        const created = await api.createCategory({
          channelId: props.activeChannel.channelId,
          catalogId: catalogEntry.catalogId,
          type: targetColumn,
          label: catalogEntry.label,
          definition: catalogEntry.definition,
          enabled: true
        })
        setCategories((current) => [...current, created])
      }

      showSuccessToast({
        title: 'Agent updated',
        description: `"${catalogEntry.label}" now routes to the ${targetColumn} agent.`
      })
    } catch (moveError) {
      showErrorToast({
        title: 'Assignment failed',
        description: moveError instanceof Error ? moveError.message : 'Failed to update this moderation category.'
      })
    } finally {
      setMovingIds((current) => ({ ...current, [catalogId]: false }))
    }
  }

  async function toggleCategory(catalogId: string) {
    const existing = categories.find((category) => category.catalogId === catalogId)
    if (!existing) return

    setTogglingIds((current) => ({ ...current, [catalogId]: true }))
    try {
      const updated = await api.updateCategory(existing.id, {
        enabled: !existing.enabled
      })
      setCategories((current) => current.map((category) => category.id === updated.id ? updated : category))
      showSuccessToast({
        title: updated.enabled ? 'Category enabled' : 'Category paused',
        description: `"${updated.label}" is now ${updated.enabled ? 'active' : 'paused'}.`
      })
    } catch (toggleError) {
      showErrorToast({
        title: 'Update failed',
        description: toggleError instanceof Error ? toggleError.message : 'Failed to update category status.'
      })
    } finally {
      setTogglingIds((current) => ({ ...current, [catalogId]: false }))
    }
  }

  async function toggleAgent() {
    try {
      await props.onUpdateChannelSettings({
        moderationEnabled: !props.activeChannel.moderationEnabled
      })
      showSuccessToast({
        title: !props.activeChannel.moderationEnabled ? 'Moderation agent enabled' : 'Moderation agent paused',
        description: !props.activeChannel.moderationEnabled
          ? 'Timeout and ban workflows will evaluate incoming live chat again.'
          : 'Assigned categories stay saved, but runtime enforcement is paused.'
      })
    } catch (toggleError) {
      showErrorToast({
        title: 'Agent update failed',
        description: toggleError instanceof Error ? toggleError.message : 'Failed to update the moderation agent setting.'
      })
    }
  }

  function renderLane(column: BoardColumn, title: string, description: string, items: typeof boardItems) {
    return (
      <section
        className={`board-lane ${dragOverColumn === column ? 'board-lane-active' : ''}`}
        onDragOver={(event) => {
          event.preventDefault()
          setDragOverColumn(column)
        }}
        onDragLeave={(event) => {
          const nextTarget = event.relatedTarget as Node | null
          if (!nextTarget || !(event.currentTarget as HTMLElement).contains(nextTarget)) {
            setDragOverColumn('')
          }
        }}
        onDrop={(event) => {
          event.preventDefault()
          const catalogId = draggingCatalogId || event.dataTransfer.getData('text/plain')
          void moveCard(catalogId, column)
        }}
      >
        <header className="lane-head">
          <div>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
          <span className="lane-count">{items.length}</span>
        </header>

        <div className="lane-body">
          {items.length === 0 && (
            <div className="lane-empty">
              <strong>Nothing here yet</strong>
              <p>
                {column === 'catalog'
                  ? 'Every category stays here until you assign it to an enforcement lane.'
                  : 'Drop a category card here to activate it for this agent.'}
              </p>
            </div>
          )}

          {items.map((item) => {
            const moving = !!movingIds[item.catalogId]
            const toggling = !!togglingIds[item.catalogId]

            return (
              <article
                key={item.catalogId}
                className={`policy-card ${draggingCatalogId === item.catalogId ? 'policy-card-dragging' : ''}`}
                draggable={!moving && !toggling}
                onDragStart={(event: DragEvent<HTMLElement>) => {
                  setDraggingCatalogId(item.catalogId)
                  event.dataTransfer.setData('text/plain', item.catalogId)
                }}
                onDragEnd={() => {
                  setDraggingCatalogId('')
                  setDragOverColumn('')
                }}
              >
                <div className="policy-tags">
                  <span className="catalog-chip">{item.catalogId}</span>
                  {item.type ? (
                    <span className={`state-chip ${item.enabled ? 'state-chip-on' : 'state-chip-off'}`}>
                      {item.enabled ? 'Enabled' : 'Paused'}
                    </span>
                  ) : (
                    <span className="state-chip state-chip-unassigned">Unassigned</span>
                  )}
                  {moving && <span className="state-chip state-chip-saving">Saving...</span>}
                </div>

                <h3>{item.label}</h3>
                <p>{item.definition}</p>

                {item.type ? (
                  <div className="policy-actions">
                    <button type="button" className="ghost-button" disabled={moving || toggling} onClick={() => void toggleCategory(item.catalogId)}>
                      {toggling ? 'Saving...' : item.enabled ? 'Pause' : 'Enable'}
                    </button>
                    <button type="button" className="ghost-button" disabled={moving || toggling} onClick={() => void moveCard(item.catalogId, 'catalog')}>
                      Remove from agent
                    </button>
                  </div>
                ) : (
                  <span className="drag-hint">Drag into timeout or ban to activate this category.</span>
                )}
              </article>
            )
          })}
        </div>
      </section>
    )
  }

  return (
    <div className="page-wrap">
      <header className="page-header">
        <div>
          <p className="eyebrow">Chat safety</p>
          <h1>Moderation Rules</h1>
          <p className="page-text">
            Route every canonical safety category into timeout or ban. The board is the policy surface.
          </p>
        </div>
      </header>

      <section className="panel agent-banner">
        <div>
          <p className="eyebrow">Channel switch</p>
          <h2>Moderation agent status</h2>
          <p>
            {props.activeChannel.moderationEnabled
              ? 'The moderation workflow is active and can issue timeout or ban decisions from assigned categories.'
              : 'The moderation workflow is paused. Your board stays saved, but runtime enforcement is disabled.'}
          </p>
        </div>
        <StatusSwitch
          checked={props.activeChannel.moderationEnabled}
          disabled={props.channelSettingsUpdating}
          activeLabel={props.channelSettingsUpdating ? 'Saving...' : 'Enabled'}
          inactiveLabel={props.channelSettingsUpdating ? 'Saving...' : 'Paused'}
          onToggle={() => void toggleAgent()}
        />
      </section>

      {loading && catalog.length === 0 ? (
        <EmptyPanel
          title="Loading moderation board"
          description="Fetching the canonical moderation catalog and current channel assignments."
        />
      ) : error && catalog.length === 0 ? (
        <EmptyPanel
          title="Failed to load categories"
          description={error}
          actionLabel="Retry"
          onAction={() => void loadBoard()}
        />
      ) : (
        <section className="board-grid">
          {renderLane('catalog', 'Categories', 'The full moderation catalog for this channel.', categoryLane)}
          {renderLane('timeout', 'Timeout Agent', 'Temporary enforcement for spam, escalation control, and lower-severity disruption.', timeoutLane)}
          {renderLane('ban', 'Ban Agent', 'Permanent enforcement for severe abuse, threats, scams, or malicious behavior.', banLane)}
        </section>
      )}
    </div>
  )
}

function NotFoundScreen(props: { authenticated: boolean; onNavigate: (path: AppRoute) => void }) {
  return (
    <div className="page-wrap">
      <EmptyPanel
        title="Page not found"
        description="This route does not exist in the current frontend."
        actionLabel={props.authenticated ? 'Go to dashboard' : 'Go to onboarding'}
        onAction={() => props.onNavigate(props.authenticated ? '/dashboard' : '/onboarding')}
      />
    </div>
  )
}

export default function App() {
  const [path, setPath] = useState(() => trimPathname(window.location.pathname))
  const [session, setSession] = useState<AuthSession | null>(null)
  const [booting, setBooting] = useState(true)
  const [authenticating, setAuthenticating] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [channelSettingsUpdating, setChannelSettingsUpdating] = useState<Record<string, boolean>>({})

  const syncLocation = useEffectEvent(() => {
    setPath(trimPathname(window.location.pathname))
  })

  useEffect(() => {
    window.addEventListener('popstate', syncLocation)
    return () => window.removeEventListener('popstate', syncLocation)
  }, [syncLocation])

  const bootstrap = useEffectEvent(async () => {
    try {
      const nextSession = await api.getAuthSession()
      setSession(nextSession)
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) {
        showErrorToast({
          title: 'Session restore failed',
          description: error instanceof Error ? error.message : 'Unable to restore the current session.'
        })
      }
      setSession(null)
    } finally {
      setBooting(false)
      setAuthenticating(false)
    }
  })

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  function navigate(nextPath: AppRoute, options: { replace?: boolean } = {}) {
    if (trimPathname(window.location.pathname) === nextPath) {
      return
    }

    const url = new URL(window.location.href)
    url.pathname = nextPath
    url.search = ''

    if (options.replace) {
      window.history.replaceState({}, '', url)
    } else {
      window.history.pushState({}, '', url)
    }

    startTransition(() => {
      setPath(nextPath)
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const isAuthenticated = session !== null
  const activeChannel = session?.user.channels.find(
    (channel) => channel.channelId === session.user.activeChannelId
  ) ?? null

  useEffect(() => {
    if (booting) {
      return
    }

    if (!isAuthenticated && isProtectedRoute(String(path))) {
      navigate('/onboarding', { replace: true })
      return
    }

    if (isAuthenticated && path === '/onboarding') {
      navigate('/dashboard', { replace: true })
    }
  }, [booting, isAuthenticated, path])

  async function startGoogleLogin() {
    setAuthenticating(true)
    const loginUrl = new URL(buildBackendUrl('/api/auth/google/start'))
    loginUrl.searchParams.set(
      'returnTo',
      new URL('/dashboard', window.location.origin).toString()
    )
    window.location.assign(loginUrl.toString())
  }

  async function logout() {
    setLoggingOut(true)
    try {
      await api.logout()
      setSession(null)
      clearToasts()
      navigate('/onboarding', { replace: true })
    } catch (error) {
      showErrorToast({
        title: 'Logout failed',
        description: error instanceof Error ? error.message : 'Failed to sign out.'
      })
    } finally {
      setLoggingOut(false)
    }
  }

  async function updateChannelSettings(data: {
    qnaEnabled?: boolean
    moderationEnabled?: boolean
  }) {
    if (!session || !activeChannel) {
      throw new Error('No active channel selected')
    }

    const previousSession = session
    const channelId = activeChannel.channelId

    setChannelSettingsUpdating((current) => ({ ...current, [channelId]: true }))
    setSession({
      user: {
        ...session.user,
        channels: session.user.channels.map((channel) =>
          channel.channelId === channelId ? { ...channel, ...data } : channel
        )
      }
    })

    try {
      const nextSession = await api.updateChannelSettings(channelId, data)
      setSession(nextSession)
    } catch (error) {
      setSession(previousSession)
      throw error
    } finally {
      setChannelSettingsUpdating((current) => ({ ...current, [channelId]: false }))
    }
  }

  let content: ReactNode

  if (booting) {
    content = (
      <div className="boot-screen">
        <div className="boot-panel">
          <span className="brand-mark">M</span>
          <strong>Loading creator control surface...</strong>
        </div>
      </div>
    )
  } else if (path === '/') {
    content = <LandingScreen onNavigate={navigate} />
  } else if (!isAuthenticated || !activeChannel) {
    content = (
      <OnboardingScreen
        authenticated={isAuthenticated}
        authenticating={authenticating}
        onGoogleLogin={() => void startGoogleLogin()}
      />
    )
  } else {
    let page: ReactNode
    if (path === '/dashboard') {
      page = <DashboardPage activeChannel={activeChannel} onNavigate={navigate} />
    } else if (path === '/qna') {
      page = (
        <QnaPage
          activeChannel={activeChannel}
          channelSettingsUpdating={!!channelSettingsUpdating[activeChannel.channelId]}
          onUpdateChannelSettings={updateChannelSettings}
        />
      )
    } else if (path === '/moderation') {
      page = (
        <ModerationPage
          activeChannel={activeChannel}
          channelSettingsUpdating={!!channelSettingsUpdating[activeChannel.channelId]}
          onUpdateChannelSettings={updateChannelSettings}
        />
      )
    } else {
      page = <NotFoundScreen authenticated={true} onNavigate={navigate} />
    }

    content = (
      <AppShell
        currentPath={String(path)}
        channel={activeChannel}
        onNavigate={navigate}
        onLogout={logout}
        busy={loggingOut}
      >
        {page}
      </AppShell>
    )
  }

  return (
    <>
      <ToastViewport />
      {content}
    </>
  )
}
