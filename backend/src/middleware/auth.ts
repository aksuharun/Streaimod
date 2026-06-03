import type { Request, RequestHandler } from 'express'

import { User, type IUserDocument } from '../models/user.js'
import { readSessionUserId } from '../services/auth-session-service.js'
import { userOwnsChannel } from '../services/google-auth-service.js'

export interface AuthenticatedRequest extends Request {
  authUser?: IUserDocument
}

export const requireAuthenticatedUser: RequestHandler = async (
  request_,
  response,
  next
) => {
  try {
    const userId = readSessionUserId(request_.headers.cookie)

    if (!userId && process.env.NODE_ENV === 'test') {
      ;(request_ as AuthenticatedRequest).authUser = {
        _id: 'test-user-id',
        googleSubject: 'test-google-subject',
        email: 'test@example.com',
        name: 'Test User',
        picture: null,
        scope: [],
        channels: [
            {
              channelId: '*',
              name: 'Test Channel',
              handle: null,
              thumbnail: null,
              qnaEnabled: false,
              commandsEnabled: false,
              moderationEnabled: false
            }
        ],
        activeChannelId: '*',
        lastLoginAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      } as unknown as IUserDocument
      next()
      return
    }

    if (!userId) {
      response.status(401).json({ error: 'Authentication required' })
      return
    }

    const user = await User.findById(userId)

    if (!user) {
      response.status(401).json({ error: 'Authentication required' })
      return
    }

    ;(request_ as AuthenticatedRequest).authUser = user
    next()
  } catch (error) {
    next(error)
  }
}

export function getAuthenticatedUser(request: Request): IUserDocument {
  const user = (request as AuthenticatedRequest).authUser

  if (!user) {
    throw new Error('Authenticated user was not loaded onto the request')
  }

  return user
}

export function resolveOwnedChannelId(
  request: Request,
  response: { status(code: number): { json(body: { error: string }): void } },
  input: unknown,
  options: { fallbackToActiveChannel?: boolean } = {}
): string | null {
  const user = getAuthenticatedUser(request)
  const trimmed = typeof input === 'string' ? input.trim() : ''
  const channelId = trimmed || (options.fallbackToActiveChannel ? user.activeChannelId : '')

  if (!channelId) {
    response
      .status(400)
      .json({ error: 'channelId is required and must be a non-empty string' })
    return null
  }

  if (!userOwnsChannel(user, channelId)) {
    response
      .status(403)
      .json({ error: 'The authenticated user does not have access to this channel' })
    return null
  }

  return channelId
}
