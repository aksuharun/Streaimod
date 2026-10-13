import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  MessageCircle,
  Play,
  ShieldCheck,
  Terminal
} from 'lucide-react'

import '../styles/landing.css'

interface LandingPageProps {
  onNavigate: (path: '/onboarding') => void
}

const upcomingFeatures = [
  {
    number: '01',
    category: 'Audience questions',
    title: 'Know what keeps coming up.',
    description:
      'Discover your audience’s most frequently asked questions, so you know which answers deserve a place in your Q&A library.'
  },
  {
    number: '02',
    category: 'Comment topics',
    title: 'See the conversation, not the noise.',
    description:
      'Group comments by topic to make sense of what people are talking about, beyond a scrolling wall of individual messages.'
  },
  {
    number: '03',
    category: 'Transcript search',
    title: 'Find the thought. Not just the word.',
    description:
      'Search video transcripts by meaning, so a question can lead you to relevant content even when the wording is different.'
  }
]

function LandingBrand() {
  return (
    <a className="landing-brand" href="#top" aria-label="Streaimod home">
      <img className="landing-brand-logo" src="/logo.png" alt="" width="36" height="36" />
      <span className="landing-wordmark">
        streaimod<span className="landing-wordmark-dot">.</span>
      </span>
    </a>
  )
}

function HeroOrbits() {
  return (
    <div className="landing-orbits" aria-hidden="true">
      <span className="landing-orbit landing-orbit--inner" />
      <span className="landing-orbit landing-orbit--middle" />
      <span className="landing-orbit landing-orbit--outer" />
      <span className="landing-orbit landing-orbit--edge" />
      <span className="landing-orbit-symbol landing-orbit-symbol--answers">
        <MessageCircle size={27} strokeWidth={1.7} />
      </span>
      <span className="landing-orbit-symbol landing-orbit-symbol--commands">
        <Terminal size={27} strokeWidth={1.7} />
      </span>
      <span className="landing-orbit-symbol landing-orbit-symbol--rules">
        <ShieldCheck size={27} strokeWidth={1.7} />
      </span>
      <span className="landing-orbit-symbol landing-orbit-symbol--stream">
        <Play size={25} strokeWidth={1.7} />
      </span>
      <span className="landing-orbit-symbol landing-orbit-symbol--approved">
        <Check size={28} strokeWidth={1.7} />
      </span>
      <span className="landing-orbit-symbol landing-orbit-symbol--channel">
        <ArrowUpRight size={28} strokeWidth={1.7} />
      </span>
    </div>
  )
}

function ChatPreview() {
  return (
    <figure className="landing-preview">
      <div className="landing-preview-note" aria-hidden="true">
        A little help
        <br />
        behind the scenes.
      </div>
      <div className="landing-chat">
        <div className="landing-chat-header">
          <div className="landing-chat-title">
            <MessageCircle size={17} strokeWidth={1.8} /> Stream chat
          </div>
          <span className="landing-chat-example">Example</span>
        </div>
        <div className="landing-chat-body">
          <div className="landing-chat-thread">
            <div className="landing-chat-message">
              <span className="landing-chat-avatar landing-chat-avatar--viewer" aria-hidden="true">
                A
              </span>
              <div className="landing-chat-content">
                <span className="landing-chat-author">
                  avery <span className="landing-chat-time">just now</span>
                </span>
                <p className="landing-chat-text">Will I be able to watch the replay?</p>
              </div>
            </div>
            <div className="landing-chat-reply">
              <span className="landing-chat-avatar landing-chat-avatar--bot" aria-hidden="true">
                <ShieldCheck size={17} strokeWidth={1.8} />
              </span>
              <div className="landing-chat-content">
                <span className="landing-chat-author">
                  streaimod <span className="landing-chat-bot-label">BOT</span>
                </span>
                <p className="landing-chat-text">
                  @avery Yep! The replay stays right here on the channel.
                </p>
                <span className="landing-chat-source">
                  <Check size={13} /> Your saved answer
                </span>
              </div>
            </div>
          </div>
          <div className="landing-chat-thread">
            <div className="landing-chat-message">
              <span className="landing-chat-avatar landing-chat-avatar--command" aria-hidden="true">
                N
              </span>
              <div className="landing-chat-content">
                <span className="landing-chat-author">noah</span>
                <p className="landing-chat-text">
                  <code className="landing-chat-command">!schedule</code>
                </p>
              </div>
            </div>
            <div className="landing-chat-reply">
              <span className="landing-chat-avatar landing-chat-avatar--bot" aria-hidden="true">
                <ShieldCheck size={17} strokeWidth={1.8} />
              </span>
              <div className="landing-chat-content">
                <span className="landing-chat-author">
                  streaimod <span className="landing-chat-bot-label">BOT</span>
                </span>
                <p className="landing-chat-text">Tuesdays & Thursdays. See you at 7 PM!</p>
                <span className="landing-chat-source">
                  <Terminal size={13} /> Your command reply
                </span>
              </div>
            </div>
          </div>
        </div>
        <div className="landing-chat-rule">
          <ShieldCheck size={17} strokeWidth={1.8} />
          <span>Spam detected</span>
          <span className="landing-chat-rule-action">
            Timeout <Check size={12} />
          </span>
        </div>
        <div className="landing-chat-footer">
          <span className="landing-status-dot" /> Your rules, working in the background.
        </div>
      </div>
      <figcaption className="landing-preview-caption">
        Illustrative chat. Actual replies and actions follow your saved rules.
      </figcaption>
    </figure>
  )
}

export default function LandingPage({ onNavigate }: LandingPageProps) {
  const connectChannel = () => onNavigate('/onboarding')

  return (
    <div className="landing" id="top">
      <a className="landing-skip-link" href="#landing-main">
        Skip to content
      </a>
      <header className="landing-masthead landing-container">
        <LandingBrand />
        <nav className="landing-navigation" aria-label="Main navigation">
          <a className="landing-navigation-link" href="#features">
            The toolkit
          </a>
          <a className="landing-navigation-link" href="#workflow">
            How it works
          </a>
          <a className="landing-navigation-link" href="#roadmap">
            What’s next
          </a>
        </nav>
        <button className="landing-connect-link" type="button" onClick={connectChannel}>
          Connect YouTube <ArrowUpRight size={17} />
        </button>
      </header>

      <main id="landing-main" tabIndex={-1}>
        <section className="landing-intro landing-container" aria-labelledby="landing-title">
          <HeroOrbits />
          <div className="landing-intro-copy">
            <h1 className="landing-title" id="landing-title">
              Be in the moment.
              <br />
              <span className="landing-title-aside">Not in the chat.</span>
            </h1>
            <p className="landing-intro-description">
              You bring the stream. We’ll help with the repeat questions, chat commands, and
              moderation—using the answers and rules you choose.
            </p>
            <div className="landing-intro-actions">
              <button className="landing-button" type="button" onClick={connectChannel}>
                Connect your channel <ArrowUpRight size={19} />
              </button>
              <a className="landing-text-link" href="#features">
                Take a look <ArrowDown size={16} />
              </a>
            </div>
            <p className="landing-platform-note">
              <Play size={16} strokeWidth={1.8} /> Built for YouTube livestreams
            </p>
          </div>
          <ChatPreview />
        </section>

        <div
          className="landing-principles landing-container"
          role="group"
          aria-label="Our approach"
        >
          <span className="landing-principles-label">Your channel comes first.</span>
          <span className="landing-principle">
            <Check size={16} /> Answers you approve
          </span>
          <span className="landing-principle">
            <Check size={16} /> Rules you control
          </span>
          <span className="landing-principle">
            <Check size={16} /> Pause whenever you want
          </span>
        </div>

        <section
          className="landing-toolkit landing-container"
          id="features"
          aria-labelledby="landing-toolkit-title"
        >
          <div className="landing-section-heading">
            <div>
              <p className="landing-section-index">01 / The live toolkit</p>
              <h2 className="landing-heading" id="landing-toolkit-title">
                A little backup.
                <br />A lot more headspace.
              </h2>
            </div>
            <p className="landing-section-description">
              For the moments when your chat needs attention, but your audience needs you.
            </p>
          </div>

          <article className="landing-tool">
            <span className="landing-tool-icon" aria-hidden="true">
              <MessageCircle size={25} strokeWidth={1.5} />
            </span>
            <div className="landing-tool-copy">
              <p className="landing-tool-label">Q&A replies</p>
              <h3 className="landing-tool-title">Same question. Your answer.</h3>
              <p className="landing-description">
                Save answers to the questions you hear all the time. AI matches the question; your
                exact saved reply goes to chat. No made-up answers.
              </p>
            </div>
            <div className="landing-answer-example" role="group" aria-label="Example Q&A rule">
              <span className="landing-example-question">“When’s your next stream?”</span>
              <ArrowDown size={16} aria-hidden="true" />
              <span className="landing-example-answer">
                <Check size={14} /> Your approved reply
              </span>
            </div>
          </article>

          <article className="landing-tool">
            <span className="landing-tool-icon" aria-hidden="true">
              <Terminal size={25} strokeWidth={1.5} />
            </span>
            <div className="landing-tool-copy">
              <p className="landing-tool-label">Chat commands</p>
              <h3 className="landing-tool-title">One shortcut. Right to the point.</h3>
              <p className="landing-description">
                Your links, your schedule, that thing everyone asks for. Give each command a saved
                reply and let viewers get what they need.
              </p>
            </div>
            <div
              className="landing-command-example"
              role="group"
              aria-label="Example chat commands"
            >
              <span className="landing-command-line">
                <code className="landing-command-trigger">!links</code>
                <ArrowRight size={14} />
                <span className="landing-command-response">Your socials</span>
              </span>
              <span className="landing-command-line">
                <code className="landing-command-trigger">!schedule</code>
                <ArrowRight size={14} />
                <span className="landing-command-response">Your next stream</span>
              </span>
            </div>
          </article>

          <article className="landing-tool">
            <span className="landing-tool-icon" aria-hidden="true">
              <ShieldCheck size={25} strokeWidth={1.5} />
            </span>
            <div className="landing-tool-copy">
              <p className="landing-tool-label">AI moderation</p>
              <h3 className="landing-tool-title">You draw the line.</h3>
              <p className="landing-description">
                Choose which categories deserve a timeout or a ban. Turn rules on, pause them, or
                change your approach. It’s your channel, not a one-size-fits-all rulebook.
              </p>
            </div>
            <div
              className="landing-rules-example"
              role="group"
              aria-label="Example moderation assignments"
            >
              <span className="landing-rule-line">
                <span>Spam</span>
                <ArrowRight size={14} />
                <span className="landing-rule-timeout">Timeout</span>
              </span>
              <span className="landing-rule-line">
                <span>Scam</span>
                <ArrowRight size={14} />
                <span className="landing-rule-ban">Ban</span>
              </span>
            </div>
          </article>
        </section>

        <section
          className="landing-workflow"
          id="workflow"
          aria-labelledby="landing-workflow-title"
        >
          <div className="landing-workflow-content landing-container">
            <div className="landing-workflow-intro">
              <p className="landing-section-index">02 / From setup to stream</p>
              <h2 className="landing-heading" id="landing-workflow-title">
                Set the rules.
                <br />
                <span className="landing-workflow-accent">Then go live.</span>
              </h2>
              <p className="landing-workflow-description">
                A few things to set up before you hit the button. A few less things to think about
                after.
              </p>
              <span className="landing-workflow-note">
                <ShieldCheck size={19} /> You supply the answers.
                <br />
                You choose the rules.
              </span>
            </div>
            <ol className="landing-steps">
              <li className="landing-step">
                <span className="landing-step-number" aria-hidden="true">
                  01
                </span>
                <div>
                  <h3 className="landing-step-title">Bring your channel.</h3>
                  <p className="landing-step-description">
                    Sign in with the Google account connected to your YouTube channel.
                  </p>
                </div>
              </li>
              <li className="landing-step">
                <span className="landing-step-number" aria-hidden="true">
                  02
                </span>
                <div>
                  <h3 className="landing-step-title">Make it yours.</h3>
                  <p className="landing-step-description">
                    Add your Q&A answers and commands. Assign moderation categories to timeout or
                    ban.
                  </p>
                </div>
              </li>
              <li className="landing-step">
                <span className="landing-step-number" aria-hidden="true">
                  03
                </span>
                <div>
                  <h3 className="landing-step-title">Take the stage.</h3>
                  <p className="landing-step-description">
                    Start automation for your live stream from the dashboard. Pause individual
                    features whenever you need to.
                  </p>
                </div>
              </li>
            </ol>
          </div>
        </section>

        <section
          className="landing-roadmap landing-container"
          id="roadmap"
          aria-labelledby="landing-roadmap-title"
        >
          <div className="landing-section-heading">
            <div>
              <p className="landing-section-index">03 / On the horizon</p>
              <h2 className="landing-heading" id="landing-roadmap-title">
                Next: listen closer.
              </h2>
            </div>
            <div className="landing-roadmap-intro">
              <span className="landing-planned-label">Planned · Not available yet</span>
              <p className="landing-section-description">
                We’re looking beyond live moderation, toward a better understanding of your audience
                and your content.
              </p>
            </div>
          </div>
          <div className="landing-roadmap-list">
            {upcomingFeatures.map((feature) => (
              <article className="landing-upcoming" key={feature.number}>
                <p className="landing-upcoming-category">
                  <span>{feature.number}</span> {feature.category}
                </p>
                <h3 className="landing-upcoming-title">{feature.title}</h3>
                <p className="landing-description">{feature.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-invitation" aria-labelledby="landing-invitation-title">
          <div className="landing-invitation-content landing-container">
            <div>
              <p className="landing-section-index">Leave a little room for the good stuff.</p>
              <h2 className="landing-heading" id="landing-invitation-title">
                Less moderating.
                <br />
                More making.
              </h2>
            </div>
            <div className="landing-invitation-actions">
              <button className="landing-button" type="button" onClick={connectChannel}>
                Connect your channel <ArrowUpRight size={19} />
              </button>
              <p className="landing-invitation-note">Your next stream, with a little backup.</p>
            </div>
          </div>
        </section>
      </main>

      <footer className="landing-footer landing-container">
        <LandingBrand />
        <p className="landing-footer-note">For the people behind the stream.</p>
        <a className="landing-footer-link" href="mailto:hello@streaimod.com">
          hello@streaimod.com
        </a>
        <a
          className="landing-footer-link"
          href="https://github.com/aksuharun/Streaimod"
          target="_blank"
          rel="noreferrer"
        >
          Find us on GitHub <ArrowUpRight size={14} />
        </a>
      </footer>
    </div>
  )
}
