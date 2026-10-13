import { ArrowLeft, Check, CircleAlert, Play } from 'lucide-react'

import '../styles/onboarding.css'

interface OnboardingPageProps {
  authenticated: boolean
  onGoogleLogin: () => void
  authenticating: boolean
}

function GoogleMark() {
  return (
    <svg
      className="google-glyph"
      viewBox="-3 0 262 262"
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="xMidYMid"
      aria-hidden="true"
    >
      <path
        d="M255.878 133.451c0-10.734-.871-18.567-2.756-26.69H130.55v48.448h71.947c-1.45 12.04-9.283 30.172-26.69 42.356l-.244 1.622 38.755 30.023 2.685.268c24.659-22.774 38.875-56.282 38.875-96.027"
        fill="#4285F4"
      />
      <path
        d="M130.55 261.1c35.248 0 64.839-11.605 86.453-31.622l-41.196-31.913c-11.024 7.688-25.82 13.055-45.257 13.055-34.523 0-63.824-22.773-74.269-54.25l-1.531.13-40.298 31.187-.527 1.465C35.393 231.798 79.49 261.1 130.55 261.1"
        fill="#34A853"
      />
      <path
        d="M56.281 156.37c-2.756-8.123-4.351-16.827-4.351-25.82 0-8.994 1.595-17.697 4.206-25.82l-.073-1.73L15.26 71.312l-1.335.635C5.077 89.644 0 109.517 0 130.55s5.077 40.905 13.925 58.602l42.356-32.782"
        fill="#FBBC05"
      />
      <path
        d="M130.55 50.479c24.514 0 41.05 10.589 50.479 19.438l36.844-35.974C195.245 12.91 165.798 0 130.55 0 79.49 0 35.393 29.301 13.925 71.947l42.211 32.783c10.59-31.477 39.891-54.251 74.414-54.251"
        fill="#EB4335"
      />
    </svg>
  )
}

export default function OnboardingPage(props: OnboardingPageProps) {
  const error = new URLSearchParams(window.location.search).get('error')

  return (
    <div className="onboarding-root">
      <a className="onboarding-skip-link" href="#onboarding-main">
        Skip to content
      </a>

      <header className="onboarding-masthead">
        <a className="onboarding-brand" href="/" aria-label="Streaimod home">
          <img className="onboarding-brand-logo" src="/logo.png" alt="" width="36" height="36" />
          <span className="onboarding-wordmark">streaimod.</span>
        </a>
        <a className="onboarding-home-link" href="/">
          <ArrowLeft size={16} strokeWidth={1.8} /> Back to home
        </a>
      </header>

      <main
        className="onboarding-main"
        id="onboarding-main"
        tabIndex={-1}
        aria-labelledby="onboarding-title"
      >
        <div className="onboarding-orbits" aria-hidden="true">
          <span className="onboarding-orbit onboarding-orbit--inner" />
          <span className="onboarding-orbit onboarding-orbit--middle" />
          <span className="onboarding-orbit onboarding-orbit--outer" />
        </div>

        <section className="onboarding-panel" aria-labelledby="onboarding-title">
          <div className="onboarding-copy">
            <h1 className="onboarding-title" id="onboarding-title">
              Sign in
            </h1>
            <p className="onboarding-description">
              Use the Google account connected to your channel to continue.
            </p>
          </div>

          {error && (
            <div className="onboarding-notice onboarding-notice--error" role="alert">
              <CircleAlert size={20} strokeWidth={1.8} />
              <span className="onboarding-notice-text">{error}</span>
            </div>
          )}
          {props.authenticated && (
            <div className="onboarding-notice onboarding-notice--success" role="status">
              <Check size={20} strokeWidth={1.8} />
              <span className="onboarding-notice-text">
                Session restored. Redirecting to your dashboard.
              </span>
            </div>
          )}

          <button
            type="button"
            className="onboarding-google-button"
            disabled={props.authenticating}
            aria-busy={props.authenticating}
            onClick={props.onGoogleLogin}
          >
            <span className="onboarding-google-content">
              <GoogleMark />
              <span>
                {props.authenticating ? 'Redirecting to Google...' : 'Continue with Google'}
              </span>
            </span>
          </button>

          <p className="onboarding-helper">
            Your channel and saved moderation settings will be ready after sign-in.
          </p>
        </section>
      </main>

      <footer className="onboarding-footer">
        <Play size={16} strokeWidth={1.8} /> Built for YouTube livestreams
      </footer>
    </div>
  )
}
