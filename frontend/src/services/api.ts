import { buildBackendUrl } from './backend-url'

export interface QnaEntry {
  id: string
  channelId: string
  question: string
  normalizedQuestion: string
  answer: string
  enabled: boolean
  createdAt?: string
  updatedAt?: string
}

export interface ChatCommand {
  id: string
  channelId: string
  trigger: string
  replyText: string
  enabled: boolean
  createdAt?: string
  updatedAt?: string
}

export type ModerationCategoryType = 'ban' | 'timeout'

export interface ModerationCategory {
  id: string
  channelId: string
  catalogId: string
  type: ModerationCategoryType
  label: string
  definition: string
  enabled: boolean
  createdAt?: string
  updatedAt?: string
}

export interface CatalogEntry {
  catalogId: string
  label: string
  definition: string
  createdAt?: string
  updatedAt?: string
}

export interface BootstrapPayload {
  channelId: string
  categories: Array<{
    catalogId: string
    type: ModerationCategoryType
    enabled?: boolean
  }>
}

export interface BootstrapResponse {
  channelId: string
  createdCount: number
  skippedCount: number
  categories: ModerationCategory[]
}

export interface AuthChannel {
  channelId: string
  name: string
  handle: string | null
  thumbnail: string | null
  qnaEnabled: boolean
  commandsEnabled: boolean
  moderationEnabled: boolean
}

export interface AuthUser {
  id: string
  email: string
  name: string
  picture: string | null
  channels: AuthChannel[]
  activeChannelId: string
}

export interface AuthSession {
  user: AuthUser
}

export interface StreamSummary {
  id: string
  platform: 'youtube' | 'twitch' | 'kick'
  title: string | null
  status: 'live' | 'upcoming' | 'ended' | 'unknown'
  viewerCount: number | null
  startsAt: string | null
  fetchedAt: string
}

export interface StreamOverview {
  active: StreamSummary[]
  scheduled: StreamSummary[]
  fetchedAt: string
  warning?: string
}

export interface StreamRuntimeStatus {
  active: boolean
  channelId: string
  streamId: string | null
  startedAt: string | null
}

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

class ApiClient {
  private async request<T>(
    url: string,
    options: RequestInit = {}
  ): Promise<T> {
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 6000)
    const requestUrl = buildBackendUrl(url)
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    }

    let response: Response

    try {
      response = await fetch(requestUrl, {
        ...options,
        headers,
        credentials: 'include',
        signal: options.signal ?? controller.signal,
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new ApiError(408, 'Request timed out')
      }

      throw error
    } finally {
      window.clearTimeout(timeoutId)
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new ApiError(
        response.status,
        errorData.error || `HTTP error! status: ${response.status}`
      )
    }

    if (response.status === 204) {
      return null as unknown as T
    }

    return response.json()
  }

  // Q&A APIs
  async getQnaEntries(channelId?: string): Promise<QnaEntry[]> {
    const url = channelId ? `/api/qna?channelId=${encodeURIComponent(channelId)}` : '/api/qna'
    return this.request<QnaEntry[]>(url)
  }

  async getQnaEntry(id: string): Promise<QnaEntry> {
    return this.request<QnaEntry>(`/api/qna/${encodeURIComponent(id)}`)
  }

  async createQnaEntry(data: {
    channelId: string
    question: string
    answer: string
    enabled?: boolean
  }): Promise<QnaEntry> {
    return this.request<QnaEntry>('/api/qna', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updateQnaEntry(
    id: string,
    data: {
      question?: string
      answer?: string
      enabled?: boolean
    }
  ): Promise<QnaEntry> {
    return this.request<QnaEntry>(`/api/qna/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  }

  async deleteQnaEntry(id: string): Promise<void> {
    return this.request<void>(`/api/qna/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  }

  // Chat Command APIs
  async getChatCommands(channelId?: string): Promise<ChatCommand[]> {
    const url = channelId
      ? `/api/chat-commands?channelId=${encodeURIComponent(channelId)}`
      : '/api/chat-commands'
    return this.request<ChatCommand[]>(url)
  }

  async createChatCommand(data: {
    channelId: string
    trigger: string
    replyText: string
    enabled?: boolean
  }): Promise<ChatCommand> {
    return this.request<ChatCommand>('/api/chat-commands', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updateChatCommand(
    id: string,
    data: {
      trigger?: string
      replyText?: string
      enabled?: boolean
    }
  ): Promise<ChatCommand> {
    return this.request<ChatCommand>(`/api/chat-commands/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  }

  async deleteChatCommand(id: string): Promise<void> {
    return this.request<void>(`/api/chat-commands/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  }

  // Moderation Category APIs
  async getCategories(params?: { channelId?: string; type?: ModerationCategoryType }): Promise<ModerationCategory[]> {
    const query = new URLSearchParams()
    if (params?.channelId) query.append('channelId', params.channelId)
    if (params?.type) query.append('type', params.type)
    const queryString = query.toString()
    const url = queryString ? `/api/moderation-categories?${queryString}` : '/api/moderation-categories'
    return this.request<ModerationCategory[]>(url)
  }

  async getCategory(id: string): Promise<ModerationCategory> {
    return this.request<ModerationCategory>(`/api/moderation-categories/${encodeURIComponent(id)}`)
  }

  async createCategory(data: {
    channelId: string
    catalogId: string
    type: ModerationCategoryType
    label: string
    definition: string
    enabled?: boolean
  }): Promise<ModerationCategory> {
    return this.request<ModerationCategory>('/api/moderation-categories', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updateCategory(
    id: string,
    data: {
      catalogId?: string
      type?: ModerationCategoryType
      label?: string
      definition?: string
      enabled?: boolean
    }
  ): Promise<ModerationCategory> {
    return this.request<ModerationCategory>(`/api/moderation-categories/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  }

  async deleteCategory(id: string): Promise<void> {
    return this.request<void>(`/api/moderation-categories/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  }

  async bootstrapCategories(data: BootstrapPayload): Promise<BootstrapResponse> {
    return this.request<BootstrapResponse>('/api/moderation-categories/bootstrap', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  // Auth APIs
  async getAuthSession(): Promise<AuthSession> {
    return this.request<AuthSession>('/api/auth/me')
  }

  async updateActiveChannel(channelId: string): Promise<AuthSession> {
    return this.request<AuthSession>('/api/auth/active-channel', {
      method: 'POST',
      body: JSON.stringify({ channelId }),
    })
  }

  async updateChannelSettings(
    channelId: string,
    data: {
      qnaEnabled?: boolean
      commandsEnabled?: boolean
      moderationEnabled?: boolean
    }
  ): Promise<AuthSession> {
    return this.request<AuthSession>(
      `/api/auth/channels/${encodeURIComponent(channelId)}/settings`,
      {
        method: 'PATCH',
        body: JSON.stringify(data),
      }
    )
  }

  async logout(): Promise<void> {
    return this.request<void>('/api/auth/logout', {
      method: 'POST',
    })
  }

  // Moderation Catalog APIs
  async getCatalogEntries(): Promise<CatalogEntry[]> {
    return this.request<CatalogEntry[]>('/api/moderation-catalog')
  }

  async getStreamOverview(
    channelId?: string,
    options: { refresh?: boolean } = {}
  ): Promise<StreamOverview> {
    const query = new URLSearchParams()
    if (channelId) query.set('channelId', channelId)
    if (options.refresh) query.set('refresh', 'true')
    const queryString = query.toString()
    const url = queryString ? `/api/streams?${queryString}` : '/api/streams'
    return this.request<StreamOverview>(url)
  }

  async getStreamRuntimeStatus(channelId?: string): Promise<StreamRuntimeStatus> {
    const url = channelId ? `/api/stream/status?channelId=${encodeURIComponent(channelId)}` : '/api/stream/status'
    return this.request<StreamRuntimeStatus>(url)
  }

  async startStreamRuntime(data: { channelId?: string; streamId: string }): Promise<StreamRuntimeStatus> {
    return this.request<StreamRuntimeStatus>('/api/stream/start', {
      method: 'POST',
      body: JSON.stringify(data)
    })
  }

  async stopStreamRuntime(data?: { channelId?: string }): Promise<StreamRuntimeStatus> {
    return this.request<StreamRuntimeStatus>('/api/stream/stop', {
      method: 'POST',
      body: JSON.stringify(data ?? {})
    })
  }
}

export const api = new ApiClient()
