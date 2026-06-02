import { randomBytes } from 'node:crypto'

import { type Express, Router } from 'express'

import { getOptionalEnv } from '../config/env.js'
import {
  getAuthenticatedUser,
  requireAuthenticatedUser,
  resolveOwnedChannelId
} from '../middleware/auth.js'
import {
  authenticateGoogleUser,
  buildGoogleAuthorizationUrl,
  GoogleAuthServiceError,
  toAuthSessionDto
} from '../services/google-auth-service.js'
import {
  clearOauthStateCookieHeader,
  clearSessionCookieHeader,
  createOauthStateCookieHeader,
  createSessionCookieHeader,
  readOauthState
} from '../services/auth-session-service.js'

const router = Router()

function normalizeFrontendUrl(value: string | undefined, fallbackPath: string): string {
  const configuredBaseUrl = getOptionalEnv('FRONTEND_APP_URL', 'http://localhost:5173')

  try {
    const baseUrl = new URL(value?.trim() || configuredBaseUrl)

    if (baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:') {
      throw new Error('Unsupported protocol')
    }

    return new URL(fallbackPath, baseUrl).toString()
  } catch {
    return new URL(fallbackPath, configuredBaseUrl).toString()
  }
}

function buildOnboardingErrorRedirect(message: string, returnTo?: string): string {
  const url = new URL(normalizeFrontendUrl(returnTo, '/onboarding'))
  url.searchParams.set('error', message)
  return url.toString()
}

function buildDashboardRedirect(returnTo?: string): string {
  return normalizeFrontendUrl(returnTo, '/dashboard')
}

router.get('/google/start', (request_, response) => {
  try {
    const state = randomBytes(24).toString('hex')
    const requestedReturnTo =
      typeof request_.query.returnTo === 'string' ? request_.query.returnTo : undefined
    const returnTo = buildDashboardRedirect(requestedReturnTo)

    response.append('Set-Cookie', createOauthStateCookieHeader(state, returnTo))
    response.redirect(buildGoogleAuthorizationUrl(state))
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Missing required environment variables'
    const requestedReturnTo =
      typeof request_.query.returnTo === 'string' ? request_.query.returnTo : undefined
    response.redirect(
      buildOnboardingErrorRedirect(`Google OAuth is not configured: ${detail}`, requestedReturnTo)
    )
  }
})

router.get('/google/callback', async (request_, response) => {
  response.append('Set-Cookie', clearOauthStateCookieHeader())

  const code = typeof request_.query.code === 'string' ? request_.query.code.trim() : ''
  const state = typeof request_.query.state === 'string' ? request_.query.state.trim() : ''
  const oauthState = readOauthState(request_.headers.cookie)
  const expectedState = oauthState?.state
  const returnTo = oauthState?.returnTo

  if (!code) {
    response.redirect(
      buildOnboardingErrorRedirect(
        'Google OAuth callback is missing the authorization code',
        returnTo
      )
    )
    return
  }

  if (!state || !expectedState || state !== expectedState) {
    response.redirect(buildOnboardingErrorRedirect('Google OAuth state validation failed', returnTo))
    return
  }

  try {
    const user = await authenticateGoogleUser(code)

    response.append('Set-Cookie', createSessionCookieHeader(String(user._id)))
    response.redirect(buildDashboardRedirect(returnTo))
  } catch (error) {
    if (error instanceof GoogleAuthServiceError) {
      response.redirect(buildOnboardingErrorRedirect(error.message, returnTo))
      return
    }

    response.redirect(buildOnboardingErrorRedirect('Google OAuth login failed', returnTo))
  }
})

router.get('/me', requireAuthenticatedUser, (request_, response) => {
  response.status(200).json(toAuthSessionDto(getAuthenticatedUser(request_)))
})

router.post('/active-channel', requireAuthenticatedUser, async (request_, response, next) => {
  try {
    const body = request_.body as Record<string, unknown> | undefined

    if (!body || typeof body !== 'object') {
      response.status(400).json({ error: 'Request body is required' })
      return
    }

    const channelId = resolveOwnedChannelId(request_, response, body.channelId)

    if (!channelId) {
      return
    }

    const user = getAuthenticatedUser(request_)
    user.activeChannelId = channelId
    await user.save()

    response.status(200).json(toAuthSessionDto(user))
  } catch (error) {
    next(error)
  }
})

router.patch('/channels/:channelId/settings', requireAuthenticatedUser, async (request_, response, next) => {
  try {
    const body = request_.body as Record<string, unknown> | undefined

    if (!body || typeof body !== 'object') {
      response.status(400).json({ error: 'Request body is required' })
      return
    }

    const channelId = resolveOwnedChannelId(request_, response, request_.params.channelId)

    if (!channelId) {
      return
    }

    const updates: {
      qnaEnabled?: boolean
      moderationEnabled?: boolean
    } = {}

    if (body.qnaEnabled !== undefined) {
      if (typeof body.qnaEnabled !== 'boolean') {
        response.status(400).json({ error: 'qnaEnabled must be a boolean' })
        return
      }

      updates.qnaEnabled = body.qnaEnabled
    }

    if (body.moderationEnabled !== undefined) {
      if (typeof body.moderationEnabled !== 'boolean') {
        response.status(400).json({ error: 'moderationEnabled must be a boolean' })
        return
      }

      updates.moderationEnabled = body.moderationEnabled
    }

    if (Object.keys(updates).length === 0) {
      response.status(400).json({ error: 'At least one channel setting must be provided' })
      return
    }

    const user = getAuthenticatedUser(request_)
    const channel = user.channels.find((entry) => entry.channelId === channelId)

    if (!channel) {
      response.status(404).json({ error: 'Channel not found' })
      return
    }

    if (updates.qnaEnabled !== undefined) {
      channel.qnaEnabled = updates.qnaEnabled
    }

    if (updates.moderationEnabled !== undefined) {
      channel.moderationEnabled = updates.moderationEnabled
    }

    await user.save()

    response.status(200).json(toAuthSessionDto(user))
  } catch (error) {
    next(error)
  }
})

router.post('/logout', (_request, response) => {
  response.append('Set-Cookie', clearSessionCookieHeader())
  response.status(204).send()
})

export function registerAuthRoutes(app: Express): void {
  app.use('/api/auth', router)
}
