import { Component } from '@geajs/core'

import { router } from '../router'
import authStore from '../stores/auth-store'
import channelStore from '../stores/channel-store'

export default class ChannelSelector extends Component {
  switching = false
  error: string | null = null
  loggingOut = false

  handleChannelChange = async (data: any) => {
    const selected = data.value[0]

    if (!selected || selected === channelStore.activeChannel) {
      return
    }

    this.switching = true
    this.error = null

    try {
      await authStore.setActiveChannel(selected)
    } catch (err: any) {
      this.error = err.message || 'Failed to switch channel'
    } finally {
      this.switching = false
    }
  }

  handleLogout = async () => {
    this.loggingOut = true
    this.error = null

    try {
      await authStore.logout()
      router.replace('/onboarding')
    } catch (err: any) {
      this.error = err.message || 'Failed to log out'
    } finally {
      this.loggingOut = false
    }
  }

  template() {
    const activeChannel = channelStore.activeChannelMeta

    return (
      <div class="channel-selector flex flex-col gap-3 w-full">
        <label class="text-xs font-semibold uppercase tracking-wider text-teal-400/70">
          Connected Channel
        </label>

        {activeChannel && (
          <div class="sidebar-channel-card">
            {activeChannel.thumbnail && (
              <img
                src={activeChannel.thumbnail}
                alt={activeChannel.name}
                class="h-10 w-10 rounded-md object-cover"
              />
            )}
            <div class="min-w-0">
              <div class="truncate font-semibold text-slate-100">{activeChannel.name}</div>
              {activeChannel.handle && <div class="truncate text-slate-500">{activeChannel.handle}</div>}
            </div>
          </div>
        )}

        {this.error && (
          <div class="p-2 rounded border border-rose-500/30 bg-rose-500/10 text-rose-400 text-xs">
            {this.error}
          </div>
        )}

        <button
          type="button"
          click={this.handleLogout}
          disabled={this.loggingOut || this.switching}
          class="inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-slate-800 bg-slate-900 px-4 py-2 text-sm font-medium text-slate-100 transition-colors hover:border-slate-700 hover:bg-slate-800 disabled:pointer-events-none disabled:opacity-50"
        >
          {this.loggingOut ? 'Signing out...' : this.switching ? 'Switching...' : 'Sign Out'}
        </button>
      </div>
    )
  }
}
