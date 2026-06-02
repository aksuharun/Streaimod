import { Store } from '@geajs/core'

import { ApiError, api, type AuthSession, type AuthUser } from '../services/api'
import { buildBackendUrl } from '../services/backend-url'
import channelStore from './channel-store'

class AuthStore extends Store {
  initialized = false
  loading = false
  authenticating = false
  channelSettingsUpdating: Record<string, boolean> = {}
  user: AuthUser | null = null
  error: string | null = null

  get isAuthenticated(): boolean {
    return this.user !== null
  }

  async bootstrap() {
    if (this.initialized) {
      return
    }

    this.loading = true

    try {
      const session = await api.getAuthSession()
      this.applySession(session)
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        this.clearSession()
      } else {
        this.clearSession()
        this.error = error instanceof Error ? error.message : 'Failed to restore session'
      }
    } finally {
      this.initialized = true
      this.loading = false
      this.authenticating = false
    }
  }

  startGoogleLogin() {
    this.authenticating = true
    const loginUrl = new URL(buildBackendUrl('/api/auth/google/start'))
    loginUrl.searchParams.set('returnTo', new URL('/dashboard', window.location.origin).toString())
    window.location.assign(loginUrl.toString())
  }

  async setActiveChannel(channelId: string) {
    const session = await api.updateActiveChannel(channelId)
    this.applySession(session)
  }

  async updateChannelSettings(
    channelId: string,
    data: {
      qnaEnabled?: boolean
      moderationEnabled?: boolean
    }
  ) {
    if (this.channelSettingsUpdating[channelId]) {
      return null
    }

    const previous = channelStore.getChannelMeta(channelId)
    this.channelSettingsUpdating = {
      ...this.channelSettingsUpdating,
      [channelId]: true
    }
    channelStore.patchChannelSettings(channelId, data)
    this.patchUserChannelSettings(channelId, data)

    try {
      const session = await api.updateChannelSettings(channelId, data)
      this.applySession(session)
      return session
    } catch (error) {
      if (previous) {
        const previousSettings = {
          qnaEnabled: previous.qnaEnabled,
          moderationEnabled: previous.moderationEnabled
        }
        channelStore.patchChannelSettings(channelId, previousSettings)
        this.patchUserChannelSettings(channelId, previousSettings)
      }
      throw error
    } finally {
      const next = { ...this.channelSettingsUpdating }
      delete next[channelId]
      this.channelSettingsUpdating = next
    }
  }

  async logout() {
    await api.logout()
    this.clearSession()
  }

  private applySession(session: AuthSession) {
    this.user = session.user
    this.error = null
    this.authenticating = false
    channelStore.hydrate(
      session.user.channels.map((channel) => ({
        id: channel.channelId,
        name: channel.name,
        handle: channel.handle,
        thumbnail: channel.thumbnail,
        qnaEnabled: channel.qnaEnabled,
        moderationEnabled: channel.moderationEnabled,
      })),
      session.user.activeChannelId
    )
  }

  private patchUserChannelSettings(
    channelId: string,
    settings: {
      qnaEnabled?: boolean
      moderationEnabled?: boolean
    }
  ) {
    if (!this.user) return

    this.user = {
      ...this.user,
      channels: this.user.channels.map((channel) =>
        channel.channelId === channelId ? { ...channel, ...settings } : channel
      )
    }
  }

  private clearSession() {
    this.user = null
    this.authenticating = false
    channelStore.clear()
  }
}

const authStore = new AuthStore()

export default authStore
