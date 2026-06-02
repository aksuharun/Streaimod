import { type Application, type Express, Router } from 'express'

import {
  getAuthenticatedUser,
  requireAuthenticatedUser,
  resolveOwnedChannelId
} from '../middleware/auth.js'
import { hasEnabledModerationCategories } from '../services/moderation-category-service.js'
import { getStreamOverview } from '../services/livestream-service.js'
import {
  getManagedStreamRuntimeStatus,
  startManagedStreamRuntime,
  stopManagedStreamRuntime
} from '../services/stream-runtime-service.js'

const streamsRouter = Router()
const streamRuntimeRouter = Router()

export interface StreamRouteLocals {
  getStreamOverview?: typeof getStreamOverview
  startManagedStreamRuntime?: typeof startManagedStreamRuntime
  stopManagedStreamRuntime?: typeof stopManagedStreamRuntime
  getManagedStreamRuntimeStatus?: typeof getManagedStreamRuntimeStatus
  hasEnabledModerationCategories?: typeof hasEnabledModerationCategories
}

function getRouteLocals(app: Application): StreamRouteLocals {
  return app.locals as StreamRouteLocals
}

export function setStreamRouteDependencies(
  app: Express,
  dependencies: StreamRouteLocals
): void {
  Object.assign(getRouteLocals(app), dependencies)
}

function resolveGetStreamOverview(app: Application): typeof getStreamOverview {
  return getRouteLocals(app).getStreamOverview ?? getStreamOverview
}

function resolveStartManagedStreamRuntime(
  app: Application
): typeof startManagedStreamRuntime {
  return (
    getRouteLocals(app).startManagedStreamRuntime ?? startManagedStreamRuntime
  )
}

function resolveStopManagedStreamRuntime(
  app: Application
): typeof stopManagedStreamRuntime {
  return getRouteLocals(app).stopManagedStreamRuntime ?? stopManagedStreamRuntime
}

function resolveGetManagedStreamRuntimeStatus(
  app: Application
): typeof getManagedStreamRuntimeStatus {
  return (
    getRouteLocals(app).getManagedStreamRuntimeStatus ??
    getManagedStreamRuntimeStatus
  )
}

function resolveHasEnabledModerationCategories(
  app: Application
): typeof hasEnabledModerationCategories {
  return (
    getRouteLocals(app).hasEnabledModerationCategories ??
    hasEnabledModerationCategories
  )
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function resolveIngestBaseUrl(request: { protocol: string; get(name: string): string | undefined }): string {
  const forwardedProto = request.get('x-forwarded-proto')
  const forwardedHost = request.get('x-forwarded-host')
  const host = forwardedHost ?? request.get('host')
  const protocol = forwardedProto ?? request.protocol

  if (!host) {
    throw new Error('Unable to resolve backend host for stream runtime')
  }

  return `${protocol}://${host}`
}

function shouldForceStreamRefresh(value: unknown): boolean {
  return value === 'true' || value === '1'
}

streamsRouter.get('/', requireAuthenticatedUser, async (request_, response, next) => {
  try {
    const channelId = resolveOwnedChannelId(
      request_,
      response,
      request_.query.channelId,
      { fallbackToActiveChannel: true }
    )

    if (!channelId) {
      return
    }

    const overview = await resolveGetStreamOverview(request_.app)(
      getAuthenticatedUser(request_),
      channelId,
      {
        forceRefresh: shouldForceStreamRefresh(request_.query.refresh)
      }
    )
    response.status(200).json(overview)
  } catch (error) {
    next(error)
  }
})

streamRuntimeRouter.use(requireAuthenticatedUser)

streamRuntimeRouter.get('/status', async (request_, response, next) => {
  try {
    const channelId = resolveOwnedChannelId(
      request_,
      response,
      request_.query.channelId,
      { fallbackToActiveChannel: true }
    )

    if (!channelId) {
      return
    }

    response
      .status(200)
      .json(resolveGetManagedStreamRuntimeStatus(request_.app)(channelId))
  } catch (error) {
    next(error)
  }
})

streamRuntimeRouter.post('/start', async (request_, response, next) => {
  try {
    const body = request_.body as Record<string, unknown> | undefined

    if (!body || typeof body !== 'object') {
      response.status(400).json({ error: 'Request body is required' })
      return
    }

    const channelId = resolveOwnedChannelId(
      request_,
      response,
      body.channelId,
      { fallbackToActiveChannel: true }
    )

    if (!channelId) {
      return
    }

    const streamId = isNonEmptyString(body.streamId) ? body.streamId.trim() : ''

    if (!streamId) {
      response.status(400).json({ error: 'streamId is required and must be a non-empty string' })
      return
    }

    const hasEnabledCategories = await resolveHasEnabledModerationCategories(
      request_.app
    )(channelId)

    if (!hasEnabledCategories) {
      response.status(409).json({
        error:
          'Enable at least one moderation category before starting live moderation'
      })
      return
    }

    const user = getAuthenticatedUser(request_)
    const overview = await resolveGetStreamOverview(request_.app)(
      user,
      channelId
    )
    const activeStream = overview.active.find((stream) => stream.id === streamId)

    if (!activeStream) {
      response.status(404).json({ error: 'Active stream not found for the selected channel' })
      return
    }

    const status = await resolveStartManagedStreamRuntime(request_.app)(
      {
        channelId,
        streamId,
        ingestUrl: new URL('/api/chat/ingest', resolveIngestBaseUrl(request_)).toString()
      }
    )

    response.status(200).json(status)
  } catch (error) {
    next(error)
  }
})

streamRuntimeRouter.post('/stop', async (request_, response, next) => {
  try {
    const body = request_.body as Record<string, unknown> | undefined
    const channelId = resolveOwnedChannelId(
      request_,
      response,
      body?.channelId,
      { fallbackToActiveChannel: true }
    )

    if (!channelId) {
      return
    }

    response
      .status(200)
      .json(await resolveStopManagedStreamRuntime(request_.app)(channelId))
  } catch (error) {
    next(error)
  }
})

export function registerStreamRoutes(app: Express): void {
  app.use('/api/streams', streamsRouter)
  app.use('/api/stream', streamRuntimeRouter)
}
