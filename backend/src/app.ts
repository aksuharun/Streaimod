import express, {
  type ErrorRequestHandler,
  type Express,
  type RequestHandler
} from 'express'

import { getOptionalEnv } from './config/env.js'
import { registerAuthRoutes } from './routes/auth-routes.js'
import { registerChatCommandRoutes } from './routes/chat-command-routes.js'
import { registerChatIngestionRoutes } from './routes/chat-ingestion-routes.js'
import { registerModerationCatalogRoutes } from './routes/moderation-catalog-routes.js'
import { registerModerationCategoryRoutes } from './routes/moderation-category-routes.js'
import { registerModerationRoutes } from './routes/moderation-routes.js'
import { registerQnaRoutes } from './routes/qna-routes.js'
import { registerStreamRoutes } from './routes/stream-routes.js'

export type AppConfigurer = (app: Express) => void

function isAllowedOrigin(origin: string): boolean {
  const configuredOrigins = getOptionalEnv('CORS_ALLOWED_ORIGINS', '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)

  if (configuredOrigins.length > 0) {
    return configuredOrigins.includes(origin)
  }

  try {
    const url = new URL(origin)
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  } catch {
    return false
  }
}

const corsHandler: RequestHandler = (request, response, next) => {
  const origin = request.headers.origin

  if (typeof origin === 'string' && isAllowedOrigin(origin)) {
    response.header('Access-Control-Allow-Origin', origin)
    response.header('Access-Control-Allow-Credentials', 'true')
    response.header('Access-Control-Allow-Headers', 'Content-Type')
    response.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS')
    response.append('Vary', 'Origin')
  }

  if (request.method === 'OPTIONS') {
    response.status(204).send()
    return
  }

  next()
}

const notFoundHandler: RequestHandler = (_request, response) => {
  response.status(404).json({ error: 'Not found' })
}

const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (error instanceof SyntaxError && 'body' in error) {
    response.status(400).json({ error: 'Invalid JSON payload' })
    return
  }

  response.status(500).json({ error: 'Internal server error' })
}

export function createApp(configure?: AppConfigurer): Express {
  const app = express()

  app.disable('x-powered-by')
  app.use(corsHandler)
  app.use(express.json({ limit: '1mb' }))

  app.get('/health', (_request, response) => {
    response.status(200).json({ status: 'ok' })
  })

  registerAuthRoutes(app)
  registerChatCommandRoutes(app)
  registerQnaRoutes(app)
  registerModerationCatalogRoutes(app)
  registerModerationCategoryRoutes(app)
  registerModerationRoutes(app)
  registerChatIngestionRoutes(app)
  registerStreamRoutes(app)

  configure?.(app)

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
