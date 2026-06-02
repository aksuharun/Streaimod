import { Component, Link } from '@geajs/core'

const supportedFeatures = [
  {
    title: 'Live stream control center',
    description: 'Connect a YouTube channel, see live and scheduled streams, and keep operational status visible before the show starts.'
  },
  {
    title: 'AI-assisted Q&A replies',
    description: 'Define trusted answers for repeated viewer questions. The Q&A agent evaluates each chat message before deciding whether to respond.'
  },
  {
    title: 'Moderation rule orchestration',
    description: 'Organize channel-specific moderation categories across ban, timeout, review, and allow workflows with a dedicated management UI.'
  },
  {
    title: 'Channel-aware automation',
    description: 'Rules and responses stay scoped to the authenticated creator channel, so teams can manage livestream automation safely.'
  }
]

const workflowSteps = [
  {
    step: '01',
    title: 'Message captured',
    description: 'A livestream chat message enters the agent pipeline with channel context and the original viewer wording.'
  },
  {
    step: '02',
    title: 'Rules retrieved',
    description: 'Enabled Q&A entries for the active channel are loaded and normalized for consistent evaluation.'
  },
  {
    step: '03',
    title: 'Prompt rendered',
    description: 'The current question, channel ID, and approved answers are rendered into the Q&A decision prompt.'
  },
  {
    step: '04',
    title: 'Agent decides',
    description: 'The agent returns a structured SEND_ANSWER or DO_NOTHING decision with an auditable reason.'
  },
  {
    step: '05',
    title: 'Safe action taken',
    description: 'Only verified matches send the configured answer. Non-questions, misses, and invalid selections stay silent.'
  }
]

const comingSoon = [
  'Automated polls generated from livestream context',
  'Agent-triggered chat prompts to bring quiet viewers back in',
  'Retention-aware timing so polls land when audience energy drops',
  'Post-stream insights on questions, poll response, and moderation load'
]

export default class LandingPage extends Component {
  handleSectionJump = (sectionId: string) => {
    const target = document.getElementById(sectionId)
    if (!target) {
      return
    }

    target.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    })

    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${window.location.search}#${sectionId}`
    )
  }

  template() {
    return (
      <main class="landing-page">
        <section class="landing-hero">
          <div class="landing-orbit landing-orbit-one"></div>
          <div class="landing-orbit landing-orbit-two"></div>

          <header class="landing-nav">
            <button
              type="button"
              class="landing-brand"
              aria-label="AI Moderator home"
              click={() => this.handleSectionJump('top')}
            >
              <span class="landing-brand-mark">M</span>
              <span>
                <strong>AI Moderator</strong>
                <small>Livestream agents</small>
              </span>
            </button>

            <nav class="landing-nav-links" aria-label="Landing page navigation">
              <button type="button" class="landing-nav-link" click={() => this.handleSectionJump('features')}>Features</button>
              <button type="button" class="landing-nav-link" click={() => this.handleSectionJump('workflow')}>Workflow</button>
              <button type="button" class="landing-nav-link" click={() => this.handleSectionJump('roadmap')}>Roadmap</button>
            </nav>

            <Link to="/onboarding" label="Connect channel" class="landing-nav-action" />
          </header>

          <div id="top" class="landing-hero-grid">
            <div class="landing-hero-copy">
              <p class="landing-kicker">AI agents for high-velocity live chat</p>
              <h1>Keep livestream conversations useful, safe, and alive.</h1>
              <p class="landing-hero-text">
                AI Moderator helps creators operate live Q&A, moderation, and audience engagement from one professional control surface. Start with trusted automated answers today, then expand into proactive polls and retention workflows.
              </p>

              <div class="landing-actions">
                <Link to="/onboarding" label="Start setup" class="landing-button landing-button-primary" />
                <button
                  type="button"
                  class="landing-button landing-button-secondary"
                  click={() => this.handleSectionJump('workflow')}
                >
                  See Q&A workflow
                </button>
              </div>

              <div class="landing-trust-row" aria-label="Platform capabilities">
                <span>Google OAuth</span>
                <span>YouTube streams</span>
                <span>Structured AI decisions</span>
              </div>
            </div>

            <div class="landing-console landing-live-chat" aria-label="YouTube live chat automation preview">
              <div class="landing-live-chat-header">
                <div>
                  <span class="landing-live-dot"></span>
                  <strong>Live chat</strong>
                </div>
                <span class="landing-live-count">12,408 watching</span>
              </div>
              <div class="landing-live-chat-body">
                <div class="landing-live-message landing-live-message-muted">
                  <span class="landing-live-avatar landing-live-avatar-gold">K</span>
                  <p><strong>Kaan</strong> Loved the intro. Can we get the slides after this?</p>
                </div>
                <div class="landing-live-message landing-live-message-question">
                  <span class="landing-live-avatar landing-live-avatar-cyan">A</span>
                  <p><strong>Ayşe</strong> What time does the workshop replay go live?</p>
                </div>
                <div class="landing-live-message landing-live-message-answer">
                  <span class="landing-ai-badge">AI</span>
                  <p><strong>AI Moderator</strong> The replay goes live about 20 minutes after the stream ends. We will pin the link here as soon as it is ready.</p>
                </div>
                <div class="landing-live-message landing-live-message-muted">
                  <span class="landing-live-avatar landing-live-avatar-lime">M</span>
                  <p><strong>Mina</strong> This is exactly what I needed, thanks.</p>
                </div>
              </div>
              <div class="landing-live-chat-input">
                <span>Responding as AI Moderator</span>
                <strong>SEND_ANSWER</strong>
              </div>
            </div>
          </div>
        </section>

        <section id="features" class="landing-section landing-feature-section">
          <div class="landing-section-heading">
            <p class="landing-kicker">Supported now</p>
            <h2>Built for creators who need calm operations while chat moves fast.</h2>
          </div>

          <div class="landing-feature-grid">
            {supportedFeatures.map((feature) => (
              <article class="landing-feature-card" key={feature.title}>
                <span class="landing-feature-spark"></span>
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="workflow" class="landing-section landing-workflow-section">
          <div class="landing-section-heading landing-section-heading-narrow">
            <p class="landing-kicker">Q&A evaluation workflow</p>
            <h2>Every automated answer passes through an explicit decision path.</h2>
            <p>
              The Q&A agent is designed to stay quiet unless the message is a real question and matches one of the channel's approved entries.
            </p>
          </div>

          <div class="landing-workflow-list">
            {workflowSteps.map((item) => (
              <article class="landing-workflow-item" key={item.step}>
                <span>{item.step}</span>
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section id="roadmap" class="landing-section landing-roadmap-section">
          <div class="landing-roadmap-card">
            <div>
              <p class="landing-kicker">Coming soon</p>
              <h2>Automated polls that keep viewers participating.</h2>
              <p>
                Future agents will automatically send polls into chat, react to livestream context, and keep viewers engaged during slower moments without adding producer workload.
              </p>
            </div>

            <ul class="landing-roadmap-list">
              {comingSoon.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </section>
      </main>
    )
  }
}
