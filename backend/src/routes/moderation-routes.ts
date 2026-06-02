import { type Application, type Express, Router } from 'express'

import { requireAuthenticatedUser, resolveOwnedChannelId } from '../middleware/auth.js'
import {
  runEvoModerationWorkflow,
  type EvoModerationDependencies
} from '../services/evo-moderation-service.js'

const router = Router()

router.use(requireAuthenticatedUser)

export interface ModerationRouteLocals {
  evoModerationDependencies?: EvoModerationDependencies
}

export function setEvoModerationDependencies(
  app: Application,
  dependencies: EvoModerationDependencies
): void {
  const locals = app.locals as ModerationRouteLocals
  locals.evoModerationDependencies = dependencies
}

function getEvoModerationDependencies(
  app: Application
): EvoModerationDependencies | undefined {
  return (app.locals as ModerationRouteLocals).evoModerationDependencies
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

router.post('/evaluate', async (request_, response, next) => {
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

    const { message } = body

    if (!isNonEmptyString(message)) {
      response
        .status(400)
        .json({ error: 'message is required and must be a non-empty string' })
      return
    }

    const result = await runEvoModerationWorkflow(
      { channelId, message },
      getEvoModerationDependencies(request_.app)
    )

    response.json({
      agent: result.agent,
      action: result.action,
      catalogId: result.catalogId,
      reason: result.reason,
      stage: result.stage,
      workflow: result.workflow
    })
  } catch (error) {
    next(error)
  }
})

export function registerModerationRoutes(app: Express): void {
  app.use('/api/moderation', router)
}
