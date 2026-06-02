import {
  createYoutubeClient,
  refreshYoutubeAccessToken,
  type YoutubeChannelResolveResult,
  type YoutubeTokenRefreshResult
} from 'unified-creator-metrics'

import { getRequiredEnv } from '../config/env.js'
import { User, type IUserDocument, type IYoutubeOwnedChannel } from '../models/user.js'
import { decryptSecret, encryptSecret } from './auth-crypto.js'

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const GOOGLE_USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo'
const GOOGLE_OAUTH_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/youtube.force-ssl'
] as const

interface GoogleTokenExchangeResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
}

interface GoogleUserInfoResponse {
  sub?: string
  email?: string
  name?: string
  picture?: string
}

export interface AuthSessionDto {
  user: {
    id: string
    email: string
    name: string
    picture: string | null
    channels: Array<{
      channelId: string
      name: string
      handle: string | null
      thumbnail: string | null
      qnaEnabled: boolean
      commandsEnabled: boolean
      moderationEnabled: boolean
    }>
    activeChannelId: string
  }
}

export class GoogleAuthServiceError extends Error {
  readonly code:
    | 'TOKEN_EXCHANGE_FAILED'
    | 'PROFILE_FETCH_FAILED'
    | 'INVALID_PROFILE'
    | 'NO_CHANNELS'
    | 'REFRESH_TOKEN_MISSING'
    | 'TOKEN_REFRESH_FAILED'

  constructor(
    code:
      | 'TOKEN_EXCHANGE_FAILED'
      | 'PROFILE_FETCH_FAILED'
      | 'INVALID_PROFILE'
      | 'NO_CHANNELS'
      | 'REFRESH_TOKEN_MISSING'
      | 'TOKEN_REFRESH_FAILED',
    message: string
  ) {
    super(message)
    this.name = 'GoogleAuthServiceError'
    this.code = code
  }
}

function normalizeScope(scope: string | undefined | null): string[] {
  if (!scope) {
    return []
  }

  return scope
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function resolveGoogleClientId(): string {
  return getRequiredEnv('YOUTUBE_CLIENT_ID')
}

function resolveGoogleClientSecret(): string {
  return getRequiredEnv('YOUTUBE_CLIENT_SECRET')
}

function resolveGoogleRedirectUri(): string {
  return getRequiredEnv('GOOGLE_REDIRECT_URI')
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function mapIdentityToOwnedChannel(
  identity: YoutubeChannelResolveResult
): IYoutubeOwnedChannel {
  return {
    channelId: identity.channelId,
    name: identity.displayName ?? identity.channelId,
    handle: identity.handle || null,
    thumbnail: identity.profilePictureUrl ?? null,
    qnaEnabled: true,
    commandsEnabled: true,
    moderationEnabled: true
  }
}

function cloneOwnedChannel(channel: IYoutubeOwnedChannel): IYoutubeOwnedChannel {
  return {
    channelId: channel.channelId,
    name: channel.name,
    handle: channel.handle ?? null,
    thumbnail: channel.thumbnail ?? null,
    qnaEnabled: channel.qnaEnabled ?? true,
    commandsEnabled: channel.commandsEnabled ?? true,
    moderationEnabled: channel.moderationEnabled ?? true
  }
}

function getOwnedChannel(
  user: IUserDocument,
  channelId: string
): IYoutubeOwnedChannel | undefined {
  return user.channels.find((channel) => channel.channelId === channelId)
}

export function isChannelQnaEnabled(
  user: IUserDocument,
  channelId: string
): boolean {
  if (channelId === '*') {
    return true
  }

  return getOwnedChannel(user, channelId)?.qnaEnabled ?? true
}

export function isChannelCommandsEnabled(
  user: IUserDocument,
  channelId: string
): boolean {
  if (channelId === '*') {
    return true
  }

  return getOwnedChannel(user, channelId)?.commandsEnabled ?? true
}

export function isChannelModerationEnabled(
  user: IUserDocument,
  channelId: string
): boolean {
  if (channelId === '*') {
    return true
  }

  return getOwnedChannel(user, channelId)?.moderationEnabled ?? true
}

function shouldFetchOwnedYoutubeChannels(user: IUserDocument | null): boolean {
  if (!user || user.channels.length === 0) {
    return true
  }

  return user.channels.some(
    (channel) =>
      !isNonEmptyString(channel.channelId) ||
      !isNonEmptyString(channel.name) ||
      !isNonEmptyString(channel.thumbnail)
  )
}

async function exchangeAuthorizationCode(
  code: string,
  fetcher: typeof globalThis.fetch = globalThis.fetch
): Promise<GoogleTokenExchangeResponse> {
  const response = await fetcher(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      code,
      client_id: resolveGoogleClientId(),
      client_secret: resolveGoogleClientSecret(),
      redirect_uri: resolveGoogleRedirectUri(),
      grant_type: 'authorization_code'
    })
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new GoogleAuthServiceError(
      'TOKEN_EXCHANGE_FAILED',
      `Google token exchange failed with status ${response.status}${body ? `: ${body}` : ''}`
    )
  }

  return (await response.json()) as GoogleTokenExchangeResponse
}

async function fetchGoogleUserInfo(
  accessToken: string,
  fetcher: typeof globalThis.fetch = globalThis.fetch
): Promise<GoogleUserInfoResponse> {
  const response = await fetcher(GOOGLE_USERINFO_ENDPOINT, {
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new GoogleAuthServiceError(
      'PROFILE_FETCH_FAILED',
      `Google userinfo request failed with status ${response.status}${body ? `: ${body}` : ''}`
    )
  }

  return (await response.json()) as GoogleUserInfoResponse
}

async function fetchOwnedYoutubeChannels(accessToken: string): Promise<IYoutubeOwnedChannel[]> {
  const youtubeClient = createYoutubeClient({ accessToken })
  const identity = await youtubeClient.channels.getAuthenticatedUser()

  return [mapIdentityToOwnedChannel(identity)]
}

function mergeOwnedYoutubeChannels(
  existingUser: IUserDocument,
  fetchedChannels: IYoutubeOwnedChannel[]
): IYoutubeOwnedChannel[] {
  return fetchedChannels.map((channel) => {
    const existingChannel = getOwnedChannel(existingUser, channel.channelId)

    if (!existingChannel) {
      return channel
    }

    return {
      ...channel,
      qnaEnabled: existingChannel.qnaEnabled ?? true,
      commandsEnabled: existingChannel.commandsEnabled ?? true,
      moderationEnabled: existingChannel.moderationEnabled ?? true
    }
  })
}

function applyRefreshedTokenResult(
  user: IUserDocument,
  tokenResult: YoutubeTokenRefreshResult
): void {
  user.accessToken = encryptSecret(tokenResult.accessToken)
  user.accessTokenExpiresAt = tokenResult.expiresAt
    ? new Date(tokenResult.expiresAt)
    : null
  user.scope = normalizeScope(tokenResult.scope)
}

export function buildGoogleAuthorizationUrl(state: string): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')

  url.searchParams.set('client_id', resolveGoogleClientId())
  url.searchParams.set('redirect_uri', resolveGoogleRedirectUri())
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', GOOGLE_OAUTH_SCOPES.join(' '))
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('include_granted_scopes', 'true')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('state', state)

  return url.toString()
}

export async function authenticateGoogleUser(
  code: string,
  fetcher: typeof globalThis.fetch = globalThis.fetch
): Promise<IUserDocument> {
  const tokenResponse = await exchangeAuthorizationCode(code, fetcher)

  if (!isNonEmptyString(tokenResponse.access_token)) {
    throw new GoogleAuthServiceError(
      'TOKEN_EXCHANGE_FAILED',
      'Google token exchange did not return an access token'
    )
  }

  const profile = await fetchGoogleUserInfo(tokenResponse.access_token, fetcher)

  if (!isNonEmptyString(profile.sub) || !isNonEmptyString(profile.email)) {
    throw new GoogleAuthServiceError(
      'INVALID_PROFILE',
      'Google user profile is missing the required subject or email fields'
    )
  }

  const existingUser = await User.findOne({ googleSubject: profile.sub })
  const channels =
    !existingUser || shouldFetchOwnedYoutubeChannels(existingUser)
      ? existingUser
        ? mergeOwnedYoutubeChannels(
            existingUser,
            await fetchOwnedYoutubeChannels(tokenResponse.access_token)
          )
        : await fetchOwnedYoutubeChannels(tokenResponse.access_token)
      : existingUser.channels.map((channel) => cloneOwnedChannel(channel))

  if (channels.length === 0) {
    throw new GoogleAuthServiceError(
      'NO_CHANNELS',
      'No YouTube channel was found for the authenticated Google account'
    )
  }

  const encryptedRefreshToken = isNonEmptyString(tokenResponse.refresh_token)
    ? encryptSecret(tokenResponse.refresh_token)
    : existingUser?.refreshToken

  if (!existingUser && !encryptedRefreshToken) {
    throw new GoogleAuthServiceError(
      'TOKEN_EXCHANGE_FAILED',
      'Google OAuth login did not return a refresh token'
    )
  }

  const activeChannelId =
    existingUser && channels.some((channel) => channel.channelId === existingUser.activeChannelId)
      ? existingUser.activeChannelId
      : channels[0].channelId

  const lastLoginAt = new Date()
  const userState = {
    email: profile.email,
    name: profile.name?.trim() || profile.email,
    picture: profile.picture?.trim() || null,
    accessToken: encryptSecret(tokenResponse.access_token),
    refreshToken: encryptedRefreshToken,
    accessTokenExpiresAt:
      typeof tokenResponse.expires_in === 'number'
        ? new Date(Date.now() + tokenResponse.expires_in * 1000)
        : null,
    scope: normalizeScope(tokenResponse.scope),
    channels,
    activeChannelId,
    lastLoginAt
  }

  const user =
    existingUser ??
    (await User.create({
      googleSubject: profile.sub,
      ...userState
    }))

  if (existingUser) {
    Object.assign(user, userState)
    await user.save()
  }

  return user
}

export async function getFreshUserAccessToken(
  user: IUserDocument
): Promise<string> {
  const currentAccessToken = decryptSecret(user.accessToken)
  const expiresAtMs = user.accessTokenExpiresAt?.getTime() ?? null

  if (currentAccessToken && (!expiresAtMs || expiresAtMs - Date.now() > 60_000)) {
    return currentAccessToken
  }

  const refreshToken = decryptSecret(user.refreshToken)

  if (!refreshToken) {
    throw new GoogleAuthServiceError(
      'REFRESH_TOKEN_MISSING',
      'The authenticated user does not have a stored Google refresh token'
    )
  }

  let refreshedTokens: YoutubeTokenRefreshResult

  try {
    refreshedTokens = await refreshYoutubeAccessToken({
      clientId: resolveGoogleClientId(),
      clientSecret: resolveGoogleClientSecret(),
      refreshToken
    })
  } catch (error) {
    throw new GoogleAuthServiceError(
      'TOKEN_REFRESH_FAILED',
      error instanceof Error ? error.message : 'Failed to refresh Google access token'
    )
  }

  applyRefreshedTokenResult(user, refreshedTokens)
  await user.save()

  return refreshedTokens.accessToken
}

export function toAuthSessionDto(user: IUserDocument): AuthSessionDto {
  return {
    user: {
      id: String(user._id),
      email: user.email,
      name: user.name,
      picture: user.picture ?? null,
      channels: user.channels.map((channel) => ({
        channelId: channel.channelId,
        name: channel.name,
        handle: channel.handle,
        thumbnail: channel.thumbnail,
        qnaEnabled: channel.qnaEnabled ?? true,
        commandsEnabled: channel.commandsEnabled ?? true,
        moderationEnabled: channel.moderationEnabled ?? true
      })),
      activeChannelId: user.activeChannelId
    }
  }
}

export function userOwnsChannel(user: IUserDocument, channelId: string): boolean {
  return user.channels.some(
    (channel) => channel.channelId === '*' || channel.channelId === channelId
  )
}
