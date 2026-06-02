import {
  createYoutubeClient,
  PlatformApiError,
  type Livestream
} from 'unified-creator-metrics'

import type { IUserDocument } from '../models/user.js'
import { getOptionalEnv } from '../config/env.js'
import {
  getFreshUserAccessToken,
  GoogleAuthServiceError
} from './google-auth-service.js'

const DEFAULT_STREAM_OVERVIEW_CACHE_TTL_MS = 60_000

export interface StreamSummaryDto {
  id: string
  platform: 'youtube' | 'twitch' | 'kick'
  title: string | null
  status: 'live' | 'upcoming' | 'ended' | 'unknown'
  viewerCount: number | null
  startsAt: string | null
  fetchedAt: string
}

export interface StreamOverviewDto {
  active: StreamSummaryDto[]
  scheduled: StreamSummaryDto[]
  fetchedAt: string
  warning?: string
}

interface PlatformErrorDetail {
  status: number | null
  reason: string | null
  message: string | null
}

interface StreamOverviewCacheEntry {
  expiresAt: number
  overview?: StreamOverviewDto
  pending?: Promise<StreamOverviewLoadResult>
}

interface StreamOverviewLoadResult {
  cacheable: boolean
  overview: StreamOverviewDto
}

export interface StreamOverviewOptions {
  forceRefresh?: boolean
}

const streamOverviewCache = new Map<string, StreamOverviewCacheEntry>()

function getStreamOverviewCacheTtlMs(): number {
  const rawValue = getOptionalEnv(
    'STREAM_OVERVIEW_CACHE_TTL_MS',
    String(DEFAULT_STREAM_OVERVIEW_CACHE_TTL_MS)
  )
  const value = Number.parseInt(rawValue, 10)

  return Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_STREAM_OVERVIEW_CACHE_TTL_MS
}

function getUserCacheId(user: IUserDocument): string {
  return user.googleSubject || String(user._id ?? 'anonymous')
}

function getStreamOverviewCacheKey(user: IUserDocument, channelId: string): string {
  return `${getUserCacheId(user)}:${channelId}`
}

function cloneStreamOverview(overview: StreamOverviewDto): StreamOverviewDto {
  return {
    active: overview.active.map((stream) => ({ ...stream })),
    scheduled: overview.scheduled.map((stream) => ({ ...stream })),
    fetchedAt: overview.fetchedAt,
    ...(overview.warning ? { warning: overview.warning } : {})
  }
}

export function clearStreamOverviewCache(): void {
  streamOverviewCache.clear()
}

function buildDegradedOverview(warning: string): StreamOverviewDto {
  return {
    active: [],
    scheduled: [],
    fetchedAt: new Date().toISOString(),
    warning
  }
}

function extractPlatformErrorDetail(error: PlatformApiError): PlatformErrorDetail {
  const fallbackMessage = typeof error.message === 'string' ? error.message.trim() : null
  const fallbackStatus = typeof error.status === 'number' ? error.status : null
  const cause = error.cause

  if (!cause || typeof cause !== 'object') {
    return {
      status: fallbackStatus,
      reason: null,
      message: fallbackMessage
    }
  }

  const causeRecord = cause as Record<string, unknown>
  const response =
    causeRecord.response && typeof causeRecord.response === 'object'
      ? (causeRecord.response as Record<string, unknown>)
      : null
  const responseData =
    response?.data && typeof response.data === 'object'
      ? (response.data as Record<string, unknown>)
      : null
  const topLevelError =
    responseData?.error && typeof responseData.error === 'object'
      ? (responseData.error as Record<string, unknown>)
      : null
  const errors = Array.isArray(topLevelError?.errors)
    ? topLevelError.errors
    : Array.isArray(responseData?.errors)
      ? responseData.errors
      : []
  const firstError =
    errors[0] && typeof errors[0] === 'object' ? (errors[0] as Record<string, unknown>) : null
  const status =
    typeof response?.status === 'number'
      ? response.status
      : typeof causeRecord.status === 'number'
        ? causeRecord.status
        : fallbackStatus
  const reason =
    typeof firstError?.reason === 'string' && firstError.reason.trim().length > 0
      ? firstError.reason.trim()
      : null
  const message =
    typeof topLevelError?.message === 'string' && topLevelError.message.trim().length > 0
      ? topLevelError.message.trim()
      : typeof causeRecord.message === 'string' && causeRecord.message.trim().length > 0
        ? causeRecord.message.trim()
        : fallbackMessage

  return {
    status,
    reason,
    message
  }
}

function buildPlatformWarning(error: PlatformApiError): string {
  const detail = extractPlatformErrorDetail(error)
  const reason = detail.reason?.toLowerCase() ?? null

  if (
    detail.status === 401 ||
    reason === 'autherror' ||
    reason === 'insufficientpermissions'
  ) {
    return 'Google authorization is missing the required YouTube access. Sign in again and retry.'
  }

  if (
    reason === 'accessnotconfigured' ||
    reason === 'servicedisabled' ||
    reason === 'api_disabled'
  ) {
    return 'The YouTube Data API is not enabled for this Google Cloud project.'
  }

  if (
    reason === 'quotaexceeded' ||
    reason === 'dailylimitexceeded' ||
    reason === 'ratelimitexceeded'
  ) {
    return 'The configured YouTube Data API project has run out of quota.'
  }

  if (process.env.NODE_ENV !== 'production') {
    const debugParts = [
      detail.status ? `HTTP ${detail.status}` : null,
      detail.reason ?? null
    ].filter(Boolean)

    if (debugParts.length > 0) {
      return `YouTube API rejected the stream lookup (${debugParts.join(': ')}).`
    }
  }

  return 'Unable to load YouTube stream data right now. Try again in a moment.'
}

function mapOverviewError(error: unknown): StreamOverviewDto | null {
  if (error instanceof GoogleAuthServiceError) {
    if (error.code === 'REFRESH_TOKEN_MISSING' || error.code === 'TOKEN_REFRESH_FAILED') {
      return buildDegradedOverview(
        'Google authorization expired. Sign in again to load stream data.'
      )
    }
  }

  if (error instanceof PlatformApiError) {
    const detail = extractPlatformErrorDetail(error)

    console.warn('YouTube stream overview lookup failed', {
      status: detail.status,
      reason: detail.reason,
      message: detail.message
    })

    return buildDegradedOverview(buildPlatformWarning(error))
  }

  return null
}

function toStreamSummary(stream: Livestream): StreamSummaryDto {
  return {
    id: stream.streamId,
    platform: stream.platform,
    title: stream.title,
    status: stream.status,
    viewerCount: stream.concurrentViewers ?? null,
    startsAt: stream.startedAt,
    fetchedAt: stream.fetchedAt
  }
}

function filterStreamsForChannel(streams: Livestream[], channelId: string): Livestream[] {
  return streams.filter((stream) => stream.channelId === channelId)
}

export async function getStreamOverview(
  user: IUserDocument,
  channelId: string,
  options: StreamOverviewOptions = {}
): Promise<StreamOverviewDto> {
  if (channelId === '*') {
    return {
      active: [],
      scheduled: [],
      fetchedAt: new Date().toISOString()
    }
  }

  const now = Date.now()
  const cacheKey = getStreamOverviewCacheKey(user, channelId)
  const cached = streamOverviewCache.get(cacheKey)

  if (!options.forceRefresh && cached) {
    if (cached.overview && cached.expiresAt > now) {
      return cloneStreamOverview(cached.overview)
    }

    if (cached.pending) {
      const result = await cached.pending
      return cloneStreamOverview(result.overview)
    }

    streamOverviewCache.delete(cacheKey)
  }

  const pending = loadStreamOverview(user, channelId)
  streamOverviewCache.set(cacheKey, {
    expiresAt: now + getStreamOverviewCacheTtlMs(),
    pending
  })

  try {
    const result = await pending

    if (result.cacheable) {
      streamOverviewCache.set(cacheKey, {
        expiresAt: Date.now() + getStreamOverviewCacheTtlMs(),
        overview: cloneStreamOverview(result.overview)
      })
    } else {
      streamOverviewCache.delete(cacheKey)
    }

    return cloneStreamOverview(result.overview)
  } catch (error) {
    streamOverviewCache.delete(cacheKey)
    throw error
  }
}

async function loadStreamOverview(
  user: IUserDocument,
  channelId: string
): Promise<StreamOverviewLoadResult> {
  try {
    const accessToken = await getFreshUserAccessToken(user)
    const youtube = createYoutubeClient({ accessToken })

    const [active, scheduled] = await Promise.all([
      youtube.livestreams.getAuthenticatedChannelActive(),
      youtube.livestreams.getAuthenticatedChannelScheduled()
    ])

    return {
      cacheable: true,
      overview: {
        active: filterStreamsForChannel(active, channelId).map((stream) => toStreamSummary(stream)),
        scheduled: filterStreamsForChannel(scheduled, channelId).map((stream) => toStreamSummary(stream)),
        fetchedAt: new Date().toISOString()
      }
    }
  } catch (error) {
    const degradedOverview = mapOverviewError(error)

    if (degradedOverview) {
      return {
        cacheable: !(error instanceof GoogleAuthServiceError),
        overview: degradedOverview
      }
    }

    throw error
  }
}
