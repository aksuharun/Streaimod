import { type Application, type Express, Router } from 'express'

import {
  getAuthenticatedUser,
  requireAuthenticatedUser,
  resolveOwnedChannelId
} from '../middleware/auth.js'
import type { IQnaEntryDocument } from '../models/qna-entry.js'
import {
  runQnaAgentWorkflow,
  type QnaAgentDependencies
} from '../services/qna-agent-service.js'
import { userOwnsChannel } from '../services/google-auth-service.js'
import {
  createEntry,
  deleteEntry,
  getEntry,
  listEntries,
  QnaServiceError,
  updateEntry
} from '../services/qna-service.js'

const router = Router()

router.use(requireAuthenticatedUser)

export interface QnaRouteLocals {
  qnaAgentDependencies?: QnaAgentDependencies
}

export function setQnaAgentDependencies(
  app: Application,
  dependencies: QnaAgentDependencies
): void {
  const locals = app.locals as QnaRouteLocals
  locals.qnaAgentDependencies = dependencies
}

function getQnaAgentDependencies(app: Application): QnaAgentDependencies | undefined {
  return (app.locals as QnaRouteLocals).qnaAgentDependencies
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function toEntryDto(doc: IQnaEntryDocument) {
  return {
    id: String(doc._id),
    channelId: doc.channelId,
    question: doc.question,
    normalizedQuestion: doc.normalizedQuestion,
    answer: doc.answer,
    enabled: doc.enabled,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  }
}

router.post('/', async (request_, response, next) => {
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

    const { question, answer } = body

    if (!isNonEmptyString(question)) {
      response.status(400).json({ error: 'question is required and must be a non-empty string' })
      return
    }

    if (!isNonEmptyString(answer)) {
      response.status(400).json({ error: 'answer is required and must be a non-empty string' })
      return
    }

    const entry = await createEntry({
      channelId,
      question,
      answer,
      enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined
    })

    response.status(201).json(toEntryDto(entry))
  } catch (error) {
    if (error instanceof QnaServiceError) {
      if (error.code === 'NORMALIZED_EMPTY') {
        response.status(400).json({ error: error.message })
        return
      }
      if (error.code === 'DUPLICATE_QUESTION') {
        response.status(409).json({ error: error.message })
        return
      }
    }
    next(error)
  }
})

router.get('/', async (request_, response, next) => {
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

    const entries = await listEntries(channelId === '*' ? undefined : channelId)

    response.json(entries.map(toEntryDto))
  } catch (error) {
    next(error)
  }
})

router.get('/:id', async (request_, response, next) => {
  try {
    const entry = await getEntry(request_.params.id)

    if (!entry || !userOwnsChannel(getAuthenticatedUser(request_), entry.channelId)) {
      response.status(404).json({ error: 'Q&A entry not found' })
      return
    }

    response.json(toEntryDto(entry))
  } catch (error) {
    next(error)
  }
})

router.patch('/:id', async (request_, response, next) => {
  try {
    const body = request_.body as Record<string, unknown> | undefined

    if (!body || typeof body !== 'object') {
      response.status(400).json({ error: 'Request body is required' })
      return
    }

    const updateData: {
      question?: string
      answer?: string
      enabled?: boolean
    } = {}

    if (body.question !== undefined) {
      if (!isNonEmptyString(body.question)) {
        response.status(400).json({
          error: 'question must be a non-empty string'
        })
        return
      }
      updateData.question = body.question
    }

    if (body.answer !== undefined) {
      if (!isNonEmptyString(body.answer)) {
        response.status(400).json({
          error: 'answer must be a non-empty string'
        })
        return
      }
      updateData.answer = body.answer
    }

    if (body.enabled !== undefined) {
      if (typeof body.enabled !== 'boolean') {
        response.status(400).json({ error: 'enabled must be a boolean' })
        return
      }
      updateData.enabled = body.enabled
    }

    if (Object.keys(updateData).length === 0) {
      response.status(400).json({
        error: 'At least one of question, answer, or enabled must be provided'
      })
      return
    }

    const entry = await updateEntry(request_.params.id, updateData)

    if (!entry || !userOwnsChannel(getAuthenticatedUser(request_), entry.channelId)) {
      response.status(404).json({ error: 'Q&A entry not found' })
      return
    }

    response.json(toEntryDto(entry))
  } catch (error) {
    if (error instanceof QnaServiceError) {
      if (error.code === 'NORMALIZED_EMPTY') {
        response.status(400).json({ error: error.message })
        return
      }
      if (error.code === 'DUPLICATE_QUESTION') {
        response.status(409).json({ error: error.message })
        return
      }
    }
    next(error)
  }
})

router.delete('/:id', async (request_, response, next) => {
  try {
    const entry = await getEntry(request_.params.id)

    if (!entry || !userOwnsChannel(getAuthenticatedUser(request_), entry.channelId)) {
      response.status(404).json({ error: 'Q&A entry not found' })
      return
    }

    const deleted = await deleteEntry(request_.params.id)

    if (!deleted) {
      response.status(404).json({ error: 'Q&A entry not found' })
      return
    }

    response.status(204).send()
  } catch (error) {
    next(error)
  }
})

router.post('/match', async (request_, response, next) => {
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

    const { messageText } = body

    if (!isNonEmptyString(messageText)) {
      response.status(400).json({ error: 'messageText is required and must be a non-empty string' })
      return
    }

    const result = await runQnaAgentWorkflow(
      { channelId, messageText },
      getQnaAgentDependencies(request_.app)
    )

    if (!result.matched) {
      response.json({
        agent: result.agent,
        matched: false,
        action: result.action,
        workflow: result.workflow
      })
      return
    }

    response.json({
      agent: result.agent,
      matched: true,
      action: result.action,
      answer: result.answer,
      entry: toEntryDto(result.entry),
      workflow: result.workflow
    })
  } catch (error) {
    next(error)
  }
})

export function registerQnaRoutes(app: Express): void {
  app.use('/api/qna', router)
}
