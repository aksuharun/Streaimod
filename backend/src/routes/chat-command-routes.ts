import { type Express, Router } from 'express'

import {
  getAuthenticatedUser,
  requireAuthenticatedUser,
  resolveOwnedChannelId
} from '../middleware/auth.js'
import type { IChatCommandDocument } from '../models/chat-command.js'
import { userOwnsChannel } from '../services/google-auth-service.js'
import {
  ChatCommandServiceError,
  createChatCommand,
  deleteChatCommand,
  getChatCommand,
  listChatCommands,
  updateChatCommand
} from '../services/chat-command-service.js'

const router = Router()

router.use(requireAuthenticatedUser)

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function toChatCommandDto(doc: IChatCommandDocument) {
  return {
    id: String(doc._id),
    channelId: doc.channelId,
    trigger: doc.trigger,
    replyText: doc.replyText,
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

    if (!isNonEmptyString(body.trigger)) {
      response.status(400).json({ error: 'trigger is required and must be a non-empty string' })
      return
    }

    if (!isNonEmptyString(body.replyText)) {
      response.status(400).json({ error: 'replyText is required and must be a non-empty string' })
      return
    }

    if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
      response.status(400).json({ error: 'enabled must be a boolean' })
      return
    }

    const command = await createChatCommand({
      channelId,
      trigger: body.trigger,
      replyText: body.replyText,
      enabled: body.enabled
    })

    response.status(201).json(toChatCommandDto(command))
  } catch (error) {
    if (error instanceof ChatCommandServiceError) {
      if (
        error.code === 'NORMALIZED_EMPTY' ||
        error.code === 'INVALID_TRIGGER_PREFIX'
      ) {
        response.status(400).json({ error: error.message })
        return
      }

      if (error.code === 'DUPLICATE_TRIGGER') {
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

    const commands = await listChatCommands(channelId === '*' ? undefined : channelId)

    response.json(commands.map(toChatCommandDto))
  } catch (error) {
    next(error)
  }
})

router.get('/:id', async (request_, response, next) => {
  try {
    const command = await getChatCommand(request_.params.id)

    if (!command || !userOwnsChannel(getAuthenticatedUser(request_), command.channelId)) {
      response.status(404).json({ error: 'Chat command not found' })
      return
    }

    response.json(toChatCommandDto(command))
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

    const existing = await getChatCommand(request_.params.id)

    if (!existing || !userOwnsChannel(getAuthenticatedUser(request_), existing.channelId)) {
      response.status(404).json({ error: 'Chat command not found' })
      return
    }

    const updateData: {
      trigger?: string
      replyText?: string
      enabled?: boolean
    } = {}

    if (body.trigger !== undefined) {
      if (!isNonEmptyString(body.trigger)) {
        response.status(400).json({ error: 'trigger must be a non-empty string' })
        return
      }

      updateData.trigger = body.trigger
    }

    if (body.replyText !== undefined) {
      if (!isNonEmptyString(body.replyText)) {
        response.status(400).json({ error: 'replyText must be a non-empty string' })
        return
      }

      updateData.replyText = body.replyText
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
        error: 'At least one of trigger, replyText, or enabled must be provided'
      })
      return
    }

    const updated = await updateChatCommand(request_.params.id, updateData)

    if (!updated) {
      response.status(404).json({ error: 'Chat command not found' })
      return
    }

    response.json(toChatCommandDto(updated))
  } catch (error) {
    if (error instanceof ChatCommandServiceError) {
      if (
        error.code === 'NORMALIZED_EMPTY' ||
        error.code === 'INVALID_TRIGGER_PREFIX'
      ) {
        response.status(400).json({ error: error.message })
        return
      }

      if (error.code === 'DUPLICATE_TRIGGER') {
        response.status(409).json({ error: error.message })
        return
      }
    }

    next(error)
  }
})

router.delete('/:id', async (request_, response, next) => {
  try {
    const command = await getChatCommand(request_.params.id)

    if (!command || !userOwnsChannel(getAuthenticatedUser(request_), command.channelId)) {
      response.status(404).json({ error: 'Chat command not found' })
      return
    }

    const deleted = await deleteChatCommand(request_.params.id)

    if (!deleted) {
      response.status(404).json({ error: 'Chat command not found' })
      return
    }

    response.status(204).send()
  } catch (error) {
    next(error)
  }
})

export function registerChatCommandRoutes(app: Express): void {
  app.use('/api/chat-commands', router)
}
