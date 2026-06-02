import { Component } from '@geajs/core'
import { Card, CardContent, CardHeader, CardTitle } from '@geajs/ui'

import { router } from '../router'
import authStore from '../stores/auth-store'
import channelStore from '../stores/channel-store'

export default class Onboarding extends Component {
  error: string | null = null

  created() {
    if (authStore.isAuthenticated && channelStore.hasConfiguredChannel) {
      router.replace('/dashboard')
      return
    }

    const params = new URLSearchParams(window.location.search)
    this.error = params.get('error')
  }

  handleGoogleLogin = () => {
    this.error = null
    authStore.startGoogleLogin()
  }

  template() {
    return (
      <div class="min-h-screen flex items-center justify-center bg-slate-950 text-slate-100 font-sans p-6">
        <div class="fixed inset-0 pointer-events-none overflow-hidden z-0">
          <div class="absolute -top-[40%] -left-[10%] w-[60%] h-[50%] rounded-full bg-violet-600/10 blur-[120px]"></div>
          <div class="absolute -top-[30%] -right-[10%] w-[50%] h-[50%] rounded-full bg-sky-500/10 blur-[120px]"></div>
        </div>

        <div class="relative z-10 w-full max-w-lg">
          <div class="flex items-center justify-center gap-3 mb-10">
            <div class="w-10 h-10 rounded-lg bg-gradient-to-tr from-teal-500 to-cyan-400 flex items-center justify-center shadow-[0_0_20px_rgba(20,184,166,0.5)]">
              <span class="text-slate-950 font-black text-xl">M</span>
            </div>
            <div>
              <h1 class="text-xl font-bold text-slate-100 tracking-tight">
                AI Moderator
              </h1>
              <span class="text-[10px] font-semibold text-teal-400 uppercase tracking-widest">
                Setup
              </span>
            </div>
          </div>

          <Card class="border border-border/30 bg-card/15 backdrop-blur-md">
            <CardHeader>
              <CardTitle class="text-xl font-bold text-center">
                Sign in with Google
              </CardTitle>
              <p class="text-sm text-muted-foreground text-center mt-2">
                Connect your Google account to load your authenticated YouTube
                channel, store refresh tokens in MongoDB, and run moderation for
                that channel without manual ID entry.
              </p>
            </CardHeader>
            <CardContent>
              <div class="space-y-5">
                {this.error && (
                  <div class="p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-400 text-sm">
                    {this.error}
                  </div>
                )}

                <button
                  type="button"
                  click={this.handleGoogleLogin}
                  disabled={authStore.authenticating}
                  class="w-full inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium h-9 px-4 py-2 bg-teal-500 hover:bg-teal-600 disabled:bg-slate-800 disabled:text-slate-600 text-slate-950 font-bold transition-all duration-300 shadow-[0_0_15px_rgba(20,184,166,0.3)] hover:shadow-[0_0_25px_rgba(20,184,166,0.5)] disabled:pointer-events-none disabled:opacity-50"
                >
                  {authStore.authenticating ? 'Redirecting to Google...' : 'Continue with Google'}
                </button>

              </div>
            </CardContent>
          </Card>

          <p class="text-xs text-slate-500 text-center mt-6">
            Requires backend Google OAuth configuration and a persistent MongoDB connection.
          </p>
        </div>
      </div>
    )
  }
}
