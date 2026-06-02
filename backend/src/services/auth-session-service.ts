import { createHmac, timingSafeEqual } from 'node:crypto'

import { getRequiredEnv } from '../config/env.js'

export const SESSION_COOKIE_NAME = 'ai_mod_session'
export const OAUTH_STATE_COOKIE_NAME = 'ai_mod_oauth_state'

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000
const OAUTH_STATE_DURATION_MS = 10 * 60 * 1000

interface SessionPayload {
  purpose: 'session'
  userId: string
  expiresAt: number
}

interface OauthStatePayload {
  purpose: 'oauth-state'
  state: string
  returnTo: string
  expiresAt: number
}

function getSigningSecret(): string {
  return getRequiredEnv('SESSION_SECRET')
}

function sign(encodedPayload: string): string {
  return createHmac('sha256', getSigningSecret())
    .update(encodedPayload)
    .digest('base64url')
}

function isSecureCookie(): boolean {
  return process.env.NODE_ENV === 'production'
}

function serializeCookie(
  name: string,
  value: string,
  maxAgeSeconds: number
): string {
  const parts = [
    `${name}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`
  ]

  if (isSecureCookie()) {
    parts.push('Secure')
  }

  return parts.join('; ')
}

function createSignedToken(payload: SessionPayload | OauthStatePayload): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${encodedPayload}.${sign(encodedPayload)}`
}

function readCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) {
    return {}
  }

  return cookieHeader.split(';').reduce<Record<string, string>>((accumulator, item) => {
    const [rawName, ...rawValueParts] = item.trim().split('=')

    if (!rawName) {
      return accumulator
    }

    accumulator[rawName] = rawValueParts.join('=')
    return accumulator
  }, {})
}

function verifySignedToken<T extends SessionPayload | OauthStatePayload>(
  token: string | undefined,
  purpose: T['purpose']
): T | null {
  if (!token) {
    return null
  }

  const [encodedPayload, signature] = token.split('.')

  if (!encodedPayload || !signature) {
    return null
  }

  const expectedSignature = sign(encodedPayload)
  const providedSignature = Buffer.from(signature)
  const expectedSignatureBuffer = Buffer.from(expectedSignature)

  if (
    providedSignature.length !== expectedSignatureBuffer.length ||
    !timingSafeEqual(providedSignature, expectedSignatureBuffer)
  ) {
    return null
  }

  let parsedPayload: SessionPayload | OauthStatePayload

  try {
    parsedPayload = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8')
    ) as SessionPayload | OauthStatePayload
  } catch {
    return null
  }

  if (parsedPayload.purpose !== purpose || parsedPayload.expiresAt <= Date.now()) {
    return null
  }

  return parsedPayload as T
}

export function createSessionCookieHeader(userId: string): string {
  return serializeCookie(
    SESSION_COOKIE_NAME,
    createSignedToken({
      purpose: 'session',
      userId,
      expiresAt: Date.now() + SESSION_DURATION_MS
    }),
    Math.floor(SESSION_DURATION_MS / 1000)
  )
}

export function clearSessionCookieHeader(): string {
  return serializeCookie(SESSION_COOKIE_NAME, '', 0)
}

export function createOauthStateCookieHeader(state: string, returnTo: string): string {
  return serializeCookie(
    OAUTH_STATE_COOKIE_NAME,
    createSignedToken({
      purpose: 'oauth-state',
      state,
      returnTo,
      expiresAt: Date.now() + OAUTH_STATE_DURATION_MS
    }),
    Math.floor(OAUTH_STATE_DURATION_MS / 1000)
  )
}

export function clearOauthStateCookieHeader(): string {
  return serializeCookie(OAUTH_STATE_COOKIE_NAME, '', 0)
}

export function readSessionUserId(cookieHeader: string | undefined): string | null {
  const cookies = readCookies(cookieHeader)
  const payload = verifySignedToken<SessionPayload>(
    cookies[SESSION_COOKIE_NAME],
    'session'
  )

  return payload?.userId ?? null
}

export function readOauthState(
  cookieHeader: string | undefined
): { state: string; returnTo: string } | null {
  const cookies = readCookies(cookieHeader)
  const payload = verifySignedToken<OauthStatePayload>(
    cookies[OAUTH_STATE_COOKIE_NAME],
    'oauth-state'
  )

  if (!payload) {
    return null
  }

  return {
    state: payload.state,
    returnTo: payload.returnTo
  }
}
