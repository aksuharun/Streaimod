import {
  startTransition,
  useDeferredValue,
  useEffect,
  useState,
  useSyncExternalStore,
  type DragEvent,
  type FormEvent,
  type ReactNode
} from 'react'
import {
  ArrowUpRight,
  LayoutDashboard,
  LogOut,
  MessageSquareText,
  PencilLine,
  ShieldAlert,
  Terminal,
  Trash2
} from 'lucide-react'

import {
  api,
  ApiError,
  type AuthChannel,
  type AuthSession,
  type ChatCommand,
  type ModerationCategory,
  type ModerationCategoryType,
  type QnaEntry,
  type StreamSummary
} from './services/api'
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

type AppRoute = '/' | '/onboarding' | '/dashboard' | '/qna' | '/commands' | '/moderation'
type HealthStatus = 'ok' | 'error' | 'loading' | 'unknown'
type StreamStatusLabel = 'loading' | 'live' | 'scheduled' | 'empty' | 'error' | 'unknown'
type BoardColumn = 'catalog' | ModerationCategoryType

interface QnaDraft {
  question: string
  answer: string
  enabled: boolean
}

interface CommandDraft {
  trigger: string
  replyText: string
  enabled: boolean
}

const appLinks: Array<{ href: AppRoute; label: string; icon: typeof LayoutDashboard }> = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/qna', label: 'Q&A Rules', icon: MessageSquareText },
  { href: '/commands', label: 'Commands', icon: Terminal },
  { href: '/moderation', label: 'Moderation Rules', icon: ShieldAlert }
]

const featureCards = [
  {
    title: 'Live stream overview',
    description: 'Track active and scheduled streams, check system health, and start moderation from one place.'
  },
  {
    title: 'Trusted Q&A replies',
    description: 'Store exact answers for repeated viewer questions and reply only on approved matches.'
  },
  {
    title: 'Moderation lanes',
    description: 'Assign safety categories to timeout or ban and keep enforcement rules easy to understand.'
  },
  {
    title: 'Channel-safe automation',
    description: 'Everything stays scoped to the connected YouTube channel with separate Q&A and moderation controls.'
  }
]

const workflowSteps = [
  'Message received',
  'Rules loaded',
  'Prompt rendered',
  'Decision returned',
  'Action applied'
]

const roadmapItems = [
  {
    phase: 'Soon',
    title: 'Engagement prompts',
    description: 'Surface lightweight prompts during slower moments so the host can restart conversation without losing stream context.',
    tag: 'Audience flow'
  },
  {
    phase: 'In review',
    title: 'Post-stream review workspace',
    description: 'Group notable replies, moderation actions, and missed questions into one cleaner pass after the broadcast ends.',
    tag: 'Review tools'
  },
  {
    phase: 'Queued',
    title: 'Moderation workflow refinements',
    description: 'Tighten the path from category edits to runtime decisions so operators can adjust enforcement with less friction.',
    tag: 'Operator UX'
  }
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
  return (
    path === '/dashboard' ||
    path === '/qna' ||
    path === '/commands' ||
    path === '/moderation'
  )
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

function BrandLogo(props: { variant?: 'icon' | 'full' }) {
  const variant = props.variant ?? 'icon'

  return (
    <span className={`brand-mark ${variant === 'full' ? 'brand-mark-full' : ''}`}>
      <span className="brand-glyph-shell">
        <img src="/logo.png" alt="" className="brand-logo-image" />
      </span>
      {variant === 'full' ? (
        <span className="brand-wordmark">
          <strong>Streaimod</strong>
          <small>Channel moderation control</small>
        </span>
      ) : null}
    </span>
  )
}

function GoogleMark() {
  return (
    <svg className="google-glyph" viewBox="0 0 18 18" aria-hidden="true">
      <path
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.72-1.58 2.68-3.92 2.68-6.62Z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.46-.8 5.95-2.18l-2.92-2.26c-.8.54-1.83.86-3.03.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
        fill="#34A853"
      />
      <path
        d="M3.97 10.71A5.41 5.41 0 0 1 3.69 9c0-.6.1-1.18.28-1.71V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.04l3.01-2.33Z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.58c1.32 0 2.5.45 3.43 1.34l2.57-2.57A8.94 8.94 0 0 0 9 0 .9 9 0 0 0 .96 4.96l3.01 2.33c.71-2.12 2.7-3.71 5.03-3.71Z"
        fill="#EA4335"
      />
    </svg>
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
          <BrandLogo />
          <span>
            <strong>Streaimod</strong>
            <small>Stream Moderation</small>
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
              <link.icon size={16} strokeWidth={2} />
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
            <LogOut size={16} strokeWidth={2} />
            {props.busy ? 'Signing out...' : 'Sign out'}
          </button>
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
            <BrandLogo />
            <div>
              <strong>Streaimod</strong>
              <small>Stream Moderation</small>
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
            <p className="eyebrow">YouTube chat operations</p>
            <h1>Moderate live chat with clear rules.</h1>
            <p className="hero-text">
              A focused workspace for stream status, Google sign-in, trusted Q&A replies, and clear moderation rules.
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
          </div>

          <div className="broadcast-card">
            <div className="broadcast-head">
              <strong>Live chat signal</strong>
              <span>12,408 watching</span>
            </div>
            <div className="chat-stack">
              <div className="chat-message muted">
                <span className="chat-avatar">K</span>
                <p><strong>Kaan</strong> Will the replay be posted after the stream?</p>
              </div>
              <div className="chat-message question">
                <span className="chat-avatar">A</span>
                <p><strong>Ayse</strong> What time does the workshop replay go live?</p>
              </div>
              <div className="chat-message answer">
                <span className="ai-badge">AI</span>
                <p><strong>Streaimod</strong> The replay goes live about 20 minutes after the stream ends.</p>
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
          <p className="eyebrow">What it covers</p>
          <h2>A focused set of tools for live moderation.</h2>
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
          <p className="eyebrow">Reply flow</p>
          <h2>Every reply follows a short review path.</h2>
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

      <section id="roadmap" className="landing-section roadmap-section">
        <div className="roadmap-card">
          <div className="roadmap-copy">
            <div className="roadmap-heading-row">
              <p className="eyebrow">Next</p>
              <span className="roadmap-badge">Planned rollout</span>
            </div>
            <h2>Planned improvements</h2>
            <p>Careful additions focused on review, engagement, and better moderation workflows.</p>

            <div className="roadmap-summary">
              <div>
                <strong>03</strong>
                <span>tracks in motion</span>
              </div>
              <div>
                <strong>1</strong>
                <span>channel workflow</span>
              </div>
            </div>
          </div>

          <div className="roadmap-grid">
            {roadmapItems.map((item, index) => (
              <article key={item.title} className="roadmap-item">
                <div className="roadmap-item-top">
                  <span className="roadmap-step">{String(index + 1).padStart(2, '0')}</span>
                  <span className="roadmap-tag">{item.tag}</span>
                </div>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
                <div className="roadmap-item-footer">
                  <span>{item.phase}</span>
                  <ArrowUpRight size={16} strokeWidth={2} />
                </div>
              </article>
            ))}
          </div>
        </div>
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
        <div className="onboarding-brand">
          <BrandLogo variant="full" />
        </div>

        <div className="onboarding-copy">
          <p className="eyebrow">Secure access</p>
          <h1>Sign in</h1>
          <p>
            Use the Google account connected to your channel to continue.
          </p>
        </div>

        {error && <div className="error-banner">{error}</div>}
        {props.authenticated && <div className="success-banner">Session restored. Redirecting to your dashboard.</div>}

        <button
          type="button"
          className="google-button giant-button"
          disabled={props.authenticating}
          onClick={props.onGoogleLogin}
        >
          <span className="google-button-content">
            <GoogleMark />
            <span>{props.authenticating ? 'Redirecting to Google...' : 'Continue with Google'}</span>
          </span>
        </button>

        <p className="helper-text">
          Your channel and saved moderation settings will be ready after sign-in.
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

  useEffect(() => {
    let cancelled = false

    async function loadDashboardData() {
      setHealth('loading')
      setStreamsLoading(true)
      setStreamsError(null)

      try {
        const [healthResponse, overview, runtime] = await Promise.all([
          fetch(buildBackendUrl('/health'), {
            credentials: 'include'
          }),
          api.getStreamOverview(props.activeChannel.channelId),
          api.getStreamRuntimeStatus(props.activeChannel.channelId)
        ])

        if (!cancelled) {
          if (healthResponse.ok) {
            const data = (await healthResponse.json()) as { status?: string }
            setHealth(data.status === 'ok' ? 'ok' : 'error')
          } else {
            setHealth('error')
          }

          setStreams([...overview.active, ...overview.scheduled])
          setStreamsFetchedAt(overview.fetchedAt)
          setModeratedStreamId(runtime.streamId)
          setRuntimeStartedAt(runtime.startedAt)
          setStreamsLoaded(true)
          setStreamsError(overview.warning ?? null)
        }
      } catch (error) {
        if (!cancelled) {
          setHealth('error')
          setStreams([])
          setStreamsLoaded(true)
          setStreamsError(error instanceof Error ? error.message : 'Unable to check live streams')
          setModeratedStreamId(null)
          setRuntimeStartedAt(null)
        }
      } finally {
        if (!cancelled) {
          setStreamsLoading(false)
        }
      }
    }

    void loadDashboardData()

    return () => {
      cancelled = true
    }
  }, [props.activeChannel.channelId])

  async function refreshAll() {
    setSyncing(true)
    try {
      setHealth('loading')
      setStreamsLoading(true)
      setStreamsError(null)

      const [healthResponse, overview, runtime] = await Promise.all([
        fetch(buildBackendUrl('/health'), {
          credentials: 'include'
        }),
        api.getStreamOverview(props.activeChannel.channelId, { refresh: true }),
        api.getStreamRuntimeStatus(props.activeChannel.channelId)
      ])

      if (healthResponse.ok) {
        const data = (await healthResponse.json()) as { status?: string }
        setHealth(data.status === 'ok' ? 'ok' : 'error')
      } else {
        setHealth('error')
      }

      setStreams([...overview.active, ...overview.scheduled])
      setStreamsFetchedAt(overview.fetchedAt)
      setModeratedStreamId(runtime.streamId)
      setRuntimeStartedAt(runtime.startedAt)
      setStreamsLoaded(true)
      setStreamsError(overview.warning ?? null)
    } catch (error) {
      setHealth('error')
      setStreams([])
      setStreamsLoaded(true)
      setStreamsError(error instanceof Error ? error.message : 'Unable to check live streams')
      setModeratedStreamId(null)
      setRuntimeStartedAt(null)
    } finally {
      setStreamsLoading(false)
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
          <h1>Streams</h1>
          <p className="page-text">
            Check stream status, confirm system health, and start moderation when needed.
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
              <small>Manage saved answers.</small>
            </span>
            <em>
              <ArrowUpRight size={16} strokeWidth={2} />
            </em>
          </button>

          <button type="button" className="action-row" onClick={() => props.onNavigate('/moderation')}>
            <span>
              <strong>Moderation rules</strong>
              <small>Adjust timeout and ban routing.</small>
            </span>
            <em>
              <ArrowUpRight size={16} strokeWidth={2} />
            </em>
          </button>
        </aside>
      </section>
    </div>
  )
}

function QnaPage(props: {
  activeChannel: AuthChannel
  channelSettingsUpdating: boolean
  onUpdateChannelSettings: (data: {
    qnaEnabled?: boolean
    commandsEnabled?: boolean
    moderationEnabled?: boolean
  }) => Promise<void>
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

  useEffect(() => {
    let cancelled = false

    async function loadEntries() {
      setLoading(true)
      setError(null)

      try {
        const result = await api.getQnaEntries(props.activeChannel.channelId)
        if (!cancelled) {
          setEntries(result)
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load Q&A entries')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void loadEntries()

    return () => {
      cancelled = true
    }
  }, [props.activeChannel.channelId])

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
            Store exact replies for repeated questions. The agent only answers on saved matches.
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
          <button
            type="button"
            className="ghost-button"
            onClick={async () => {
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
            }}
          >
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
                            <PencilLine size={16} strokeWidth={2} />
                            Edit
                          </button>
                          <button
                            type="button"
                            className="danger-link"
                            disabled={!!deletingIds[entry.id]}
                            onClick={() => void deleteRule(entry)}
                          >
                            <Trash2 size={16} strokeWidth={2} />
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

function CommandsPage(props: {
  activeChannel: AuthChannel
  channelSettingsUpdating: boolean
  onUpdateChannelSettings: (data: {
    qnaEnabled?: boolean
    commandsEnabled?: boolean
    moderationEnabled?: boolean
  }) => Promise<void>
}) {
  const [commands, setCommands] = useState<ChatCommand[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search.trim())
  const [modalOpen, setModalOpen] = useState(false)
  const [editingCommand, setEditingCommand] = useState<ChatCommand | null>(null)
  const [draft, setDraft] = useState<CommandDraft>({
    trigger: '',
    replyText: '',
    enabled: true
  })
  const [saving, setSaving] = useState(false)
  const [togglingIds, setTogglingIds] = useState<Record<string, boolean>>({})
  const [deletingIds, setDeletingIds] = useState<Record<string, boolean>>({})

  useEffect(() => {
    let cancelled = false

    async function loadCommands() {
      setLoading(true)
      setError(null)

      try {
        const result = await api.getChatCommands(props.activeChannel.channelId)
        if (!cancelled) {
          setCommands(result)
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load commands')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void loadCommands()

    return () => {
      cancelled = true
    }
  }, [props.activeChannel.channelId])

  const filteredCommands = deferredSearch
    ? commands.filter((command) => {
        const needle = deferredSearch.toLowerCase()
        return (
          command.trigger.toLowerCase().includes(needle) ||
          command.replyText.toLowerCase().includes(needle)
        )
      })
    : commands

  function openCreateModal() {
    setEditingCommand(null)
    setDraft({ trigger: '', replyText: '', enabled: true })
    setModalOpen(true)
  }

  function openEditModal(command: ChatCommand) {
    setEditingCommand(command)
    setDraft({
      trigger: command.trigger,
      replyText: command.replyText,
      enabled: command.enabled
    })
    setModalOpen(true)
  }

  async function submitCommand(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const trigger = draft.trigger.trim()
    const replyText = draft.replyText.trim()

    if (!trigger || !replyText) {
      showErrorToast({
        title: 'Validation error',
        description: 'Trigger and reply text are both required.'
      })
      return
    }

    if (!trigger.startsWith('!')) {
      showErrorToast({
        title: 'Validation error',
        description: 'Trigger must start with !.'
      })
      return
    }

    setSaving(true)
    try {
      if (editingCommand) {
        const updated = await api.updateChatCommand(editingCommand.id, {
          trigger,
          replyText,
          enabled: draft.enabled
        })
        setCommands((current) => current.map((command) => command.id === updated.id ? updated : command))
        showSuccessToast({
          title: 'Command updated',
          description: `The ${updated.trigger} auto-reply is ready to use.`
        })
      } else {
        const created = await api.createChatCommand({
          channelId: props.activeChannel.channelId,
          trigger,
          replyText,
          enabled: draft.enabled
        })
        setCommands((current) => [created, ...current])
        showSuccessToast({
          title: 'Command created',
          description: `${created.trigger} can now send its saved reply in chat.`
        })
      }

      setModalOpen(false)
      setEditingCommand(null)
    } catch (saveError) {
      showErrorToast({
        title: 'Save failed',
        description: saveError instanceof Error ? saveError.message : 'Failed to save command.'
      })
    } finally {
      setSaving(false)
    }
  }

  async function toggleCommand(command: ChatCommand) {
    setTogglingIds((current) => ({ ...current, [command.id]: true }))
    try {
      const updated = await api.updateChatCommand(command.id, {
        enabled: !command.enabled
      })
      setCommands((current) => current.map((item) => item.id === updated.id ? updated : item))
      showSuccessToast({
        title: updated.enabled ? 'Command enabled' : 'Command paused',
        description: `${updated.trigger} is now ${updated.enabled ? 'active' : 'paused'}.`
      })
    } catch (toggleError) {
      showErrorToast({
        title: 'Toggle failed',
        description: toggleError instanceof Error ? toggleError.message : 'Failed to update command status.'
      })
    } finally {
      setTogglingIds((current) => ({ ...current, [command.id]: false }))
    }
  }

  async function deleteCommand(command: ChatCommand) {
    if (!window.confirm(`Delete command "${command.trigger}"?`)) {
      return
    }

    setDeletingIds((current) => ({ ...current, [command.id]: true }))
    try {
      await api.deleteChatCommand(command.id)
      setCommands((current) => current.filter((item) => item.id !== command.id))
      showSuccessToast({
        title: 'Command deleted',
        description: 'The saved auto-reply command has been removed.'
      })
    } catch (deleteError) {
      showErrorToast({
        title: 'Delete failed',
        description: deleteError instanceof Error ? deleteError.message : 'Failed to delete command.'
      })
    } finally {
      setDeletingIds((current) => ({ ...current, [command.id]: false }))
    }
  }

  async function retryLoad() {
    setLoading(true)
    setError(null)
    try {
      const result = await api.getChatCommands(props.activeChannel.channelId)
      setCommands(result)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load commands')
    } finally {
      setLoading(false)
    }
  }

  async function toggleAgent() {
    try {
      await props.onUpdateChannelSettings({
        commandsEnabled: !props.activeChannel.commandsEnabled
      })
      showSuccessToast({
        title: !props.activeChannel.commandsEnabled ? 'Commands enabled' : 'Commands paused',
        description: !props.activeChannel.commandsEnabled
          ? 'Saved commands can reply to matching live chat triggers again.'
          : 'Saved commands stay stored, but command-based auto replies are paused.'
      })
    } catch (toggleError) {
      showErrorToast({
        title: 'Agent update failed',
        description: toggleError instanceof Error ? toggleError.message : 'Failed to update the commands setting.'
      })
    }
  }

  return (
    <div className="page-wrap">
      <header className="page-header">
        <div>
          <p className="eyebrow">Instant shortcuts</p>
          <h1>Commands</h1>
          <p className="page-text">
            Save exact triggers like <code>!linktree</code> and send a fixed reply whenever viewers use them.
          </p>
        </div>
        <button type="button" className="primary-button" onClick={openCreateModal}>
          Add command
        </button>
      </header>

      <section className="panel agent-banner">
        <div>
          <p className="eyebrow">Channel switch</p>
          <h2>Commands status</h2>
          <p>
            {props.activeChannel.commandsEnabled
              ? 'Command-based replies are enabled and can answer exact triggers like !linktree.'
              : 'Command-based replies are paused. Saved commands stay available, but live auto replies are disabled.'}
          </p>
        </div>
        <StatusSwitch
          checked={props.activeChannel.commandsEnabled}
          disabled={props.channelSettingsUpdating}
          activeLabel={props.channelSettingsUpdating ? 'Saving...' : 'Enabled'}
          inactiveLabel={props.channelSettingsUpdating ? 'Saving...' : 'Paused'}
          onToggle={() => void toggleAgent()}
        />
      </section>

      <section className="panel">
        <p className="eyebrow">How it works</p>
        <h2>Exact chat triggers with saved replies</h2>
        <p>
          Commands are matched per channel and can be enabled or paused individually. Use them for links,
          schedules, socials, or quick viewer help.
        </p>
      </section>

      {error && (
        <div className="error-banner inline-banner">
          <span>{error}</span>
          <button type="button" className="ghost-button" onClick={() => void retryLoad()}>
            Retry
          </button>
        </div>
      )}

      {loading && commands.length === 0 ? (
        <EmptyPanel
          title="Loading command replies"
          description="Pulling the saved chat commands for this channel."
        />
      ) : commands.length === 0 ? (
        <EmptyPanel
          title="No commands configured yet"
          description="Create a trigger like !linktree and map it to a saved reply for viewers."
          actionLabel="Add first command"
          onAction={openCreateModal}
        />
      ) : (
        <section className="panel">
          <div className="table-toolbar">
            <input
              type="text"
              className="search-input"
              placeholder="Filter by trigger or reply text..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <span className="toolbar-count">
              Showing <strong>{filteredCommands.length}</strong> of {commands.length}
            </span>
          </div>

          {filteredCommands.length === 0 ? (
            <EmptyPanel
              title="No commands match this filter"
              description="Try a different keyword or clear the search query."
            />
          ) : (
            <div className="table-card">
              <table>
                <thead>
                  <tr>
                    <th>Trigger</th>
                    <th>Reply text</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCommands.map((command) => (
                    <tr key={command.id}>
                      <td>
                        <strong>{command.trigger}</strong>
                      </td>
                      <td>{command.replyText}</td>
                      <td>
                        <StatusSwitch
                          checked={command.enabled}
                          disabled={!!togglingIds[command.id]}
                          activeLabel={togglingIds[command.id] ? 'Saving...' : 'Active'}
                          inactiveLabel={togglingIds[command.id] ? 'Saving...' : 'Paused'}
                          onToggle={() => void toggleCommand(command)}
                        />
                      </td>
                      <td>
                        <div className="table-actions">
                          <button type="button" className="ghost-button" onClick={() => openEditModal(command)}>
                            <PencilLine size={16} strokeWidth={2} />
                            Edit
                          </button>
                          <button
                            type="button"
                            className="danger-link"
                            disabled={!!deletingIds[command.id]}
                            onClick={() => void deleteCommand(command)}
                          >
                            <Trash2 size={16} strokeWidth={2} />
                            {deletingIds[command.id] ? 'Deleting...' : 'Delete'}
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
          title={editingCommand ? 'Modify command reply' : 'Add command reply'}
          description={
            editingCommand
              ? 'Update the trigger or saved response.'
              : 'Create a reusable chat shortcut with a fixed reply.'
          }
          onClose={() => {
            if (!saving) setModalOpen(false)
          }}
        >
          <form className="editor-form" onSubmit={(event) => void submitCommand(event)}>
            <label>
              <span>Trigger</span>
              <input
                type="text"
                className="search-input"
                value={draft.trigger}
                onChange={(event) => setDraft((current) => ({ ...current, trigger: event.target.value }))}
                placeholder="e.g. !linktree"
              />
            </label>

            <label>
              <span>Reply text</span>
              <textarea
                rows={5}
                value={draft.replyText}
                onChange={(event) => setDraft((current) => ({ ...current, replyText: event.target.value }))}
                placeholder="e.g. You can reach me at https://linktr.ee/mylink"
              />
            </label>

            <div className="editor-toggle">
              <div>
                <strong>Enable command</strong>
                <p>If disabled, the trigger stays stored but will not send its reply in chat.</p>
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
                {saving ? 'Saving...' : editingCommand ? 'Save changes' : 'Create command'}
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
  onUpdateChannelSettings: (data: {
    qnaEnabled?: boolean
    commandsEnabled?: boolean
    moderationEnabled?: boolean
  }) => Promise<void>
}) {
  const [catalog, setCatalog] = useState<Array<{ catalogId: string; label: string; definition: string }>>([])
  const [categories, setCategories] = useState<ModerationCategory[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draggingCatalogId, setDraggingCatalogId] = useState('')
  const [dragOverColumn, setDragOverColumn] = useState<BoardColumn | ''>('')
  const [movingIds, setMovingIds] = useState<Record<string, boolean>>({})
  const [togglingIds, setTogglingIds] = useState<Record<string, boolean>>({})

  useEffect(() => {
    let cancelled = false

    async function loadBoard() {
      setLoading(true)
      setError(null)

      try {
        const [catalogEntries, assignedCategories] = await Promise.all([
          api.getCatalogEntries(),
          api.getCategories({ channelId: props.activeChannel.channelId })
        ])

        if (!cancelled) {
          setCatalog(catalogEntries)
          setCategories(assignedCategories)
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load moderation categories')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void loadBoard()

    return () => {
      cancelled = true
    }
  }, [props.activeChannel.channelId])

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
            Route each safety category to timeout or ban.
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
          onAction={() => {
            void (async () => {
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
            })()
          }}
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

  useEffect(() => {
    function syncLocation() {
      setPath(trimPathname(window.location.pathname))
    }

    window.addEventListener('popstate', syncLocation)
    return () => window.removeEventListener('popstate', syncLocation)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function bootstrap() {
      try {
        const nextSession = await api.getAuthSession()
        if (!cancelled) {
          setSession(nextSession)
        }
      } catch (error) {
        if (!cancelled) {
          if (!(error instanceof ApiError && error.status === 401)) {
            showErrorToast({
              title: 'Session restore failed',
              description: error instanceof Error ? error.message : 'Unable to restore the current session.'
            })
          }
          setSession(null)
        }
      } finally {
        if (!cancelled) {
          setBooting(false)
          setAuthenticating(false)
        }
      }
    }

    void bootstrap()

    return () => {
      cancelled = true
    }
  }, [])

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
    commandsEnabled?: boolean
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
          <BrandLogo />
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
    } else if (path === '/commands') {
      page = (
        <CommandsPage
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
