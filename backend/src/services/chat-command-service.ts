import {
  ChatCommand,
  type IChatCommandDocument
} from '../models/chat-command.js'
import { User } from '../models/user.js'
import { isChannelCommandsEnabled } from './google-auth-service.js'

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i

export type ChatCommandServiceErrorCode =
  | 'NORMALIZED_EMPTY'
  | 'INVALID_TRIGGER_PREFIX'
  | 'DUPLICATE_TRIGGER'

export class ChatCommandServiceError extends Error {
  public readonly code: ChatCommandServiceErrorCode

  constructor(message: string, code: ChatCommandServiceErrorCode) {
    super(message)
    this.name = 'ChatCommandServiceError'
    this.code = code
  }
}

export interface CreateChatCommandInput {
  channelId: string
  trigger: string
  replyText: string
  enabled?: boolean
}

export interface UpdateChatCommandInput {
  trigger?: string
  replyText?: string
  enabled?: boolean
}

export interface MatchChatCommandInput {
  channelId: string
  messageText: string
}

export type ChatCommandMatchResult =
  | {
      matched: false
    }
  | {
      matched: true
      replyText: string
      command: IChatCommandDocument
    }

function isValidObjectId(value: string): boolean {
  return OBJECT_ID_PATTERN.test(value)
}

function isDuplicateKeyError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false
  }

  const err = error as Record<string, unknown>

  if (err.code === 11000 || err.code === '11000') {
    return true
  }

  if (err.name === 'DuplicateKeyError') {
    return true
  }

  if (typeof err.message === 'string') {
    const message = err.message.toLowerCase()
    return message.includes('e11000') || message.includes('duplicate key')
  }

  return false
}

export function normalizeChatCommandTrigger(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, ' ')
}

function validateNormalizedTrigger(normalizedTrigger: string): void {
  if (normalizedTrigger.length === 0) {
    throw new ChatCommandServiceError(
      'Trigger resolves to an empty value after normalization',
      'NORMALIZED_EMPTY'
    )
  }

  if (!normalizedTrigger.startsWith('!')) {
    throw new ChatCommandServiceError(
      'Trigger must start with !',
      'INVALID_TRIGGER_PREFIX'
    )
  }
}

function normalizeCreateInput(input: CreateChatCommandInput) {
  const channelId = input.channelId.trim()
  const trigger = input.trigger.trim()
  const normalizedTrigger = normalizeChatCommandTrigger(trigger)
  const replyText = input.replyText.trim()

  validateNormalizedTrigger(normalizedTrigger)

  return {
    channelId,
    trigger,
    normalizedTrigger,
    replyText,
    enabled: input.enabled ?? true
  }
}

export async function createChatCommand(
  input: CreateChatCommandInput
): Promise<IChatCommandDocument> {
  const normalized = normalizeCreateInput(input)

  const existing = await ChatCommand.findOne({
    channelId: normalized.channelId,
    normalizedTrigger: normalized.normalizedTrigger
  }).exec()

  if (existing) {
    throw new ChatCommandServiceError(
      'A command with this trigger already exists in this channel',
      'DUPLICATE_TRIGGER'
    )
  }

  try {
    return await ChatCommand.create(normalized)
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new ChatCommandServiceError(
        'A command with this trigger already exists in this channel',
        'DUPLICATE_TRIGGER'
      )
    }

    throw error
  }
}

export async function listChatCommands(
  channelId?: string
): Promise<IChatCommandDocument[]> {
  const trimmed = channelId?.trim()
  const filter: Record<string, unknown> = {}

  if (trimmed) {
    filter.channelId = trimmed
  }

  return ChatCommand.find(filter).sort({ createdAt: -1, _id: -1 }).exec()
}

export async function getChatCommand(
  id: string
): Promise<IChatCommandDocument | null> {
  if (!isValidObjectId(id)) {
    return null
  }

  return ChatCommand.findOne({ _id: id }).exec()
}

export async function updateChatCommand(
  id: string,
  input: UpdateChatCommandInput
): Promise<IChatCommandDocument | null> {
  if (!isValidObjectId(id)) {
    return null
  }

  const existing = await ChatCommand.findOne({ _id: id }).exec()

  if (!existing) {
    return null
  }

  const updateData: Record<string, unknown> = {}

  if (input.trigger !== undefined) {
    const trigger = input.trigger.trim()
    const normalizedTrigger = normalizeChatCommandTrigger(trigger)

    validateNormalizedTrigger(normalizedTrigger)

    if (normalizedTrigger !== existing.normalizedTrigger) {
      const duplicate = await ChatCommand.findOne({
        channelId: existing.channelId,
        normalizedTrigger,
        _id: { $ne: existing._id }
      }).exec()

      if (duplicate) {
        throw new ChatCommandServiceError(
          'A command with this trigger already exists in this channel',
          'DUPLICATE_TRIGGER'
        )
      }
    }

    updateData.trigger = trigger
    updateData.normalizedTrigger = normalizedTrigger
  }

  if (input.replyText !== undefined) {
    updateData.replyText = input.replyText.trim()
  }

  if (input.enabled !== undefined) {
    updateData.enabled = input.enabled
  }

  try {
    return await ChatCommand.findOneAndUpdate(
      { _id: id },
      { $set: updateData },
      { new: true }
    ).exec()
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new ChatCommandServiceError(
        'A command with this trigger already exists in this channel',
        'DUPLICATE_TRIGGER'
      )
    }

    throw error
  }
}

export async function deleteChatCommand(id: string): Promise<boolean> {
  if (!isValidObjectId(id)) {
    return false
  }

  const deleted = await ChatCommand.findOneAndDelete({ _id: id }).exec()

  return deleted !== null
}

export async function matchChatCommand(
  input: MatchChatCommandInput
): Promise<ChatCommandMatchResult> {
  const channelId = input.channelId.trim()
  const normalizedMessage = normalizeChatCommandTrigger(input.messageText)

  if (normalizedMessage.length === 0 || !normalizedMessage.startsWith('!')) {
    return { matched: false }
  }

  const channelOwner = await User.findOne({ channels: { $elemMatch: { channelId } } })
    .select({ channels: 1 })
    .exec()

  if (channelOwner && !isChannelCommandsEnabled(channelOwner, channelId)) {
    return { matched: false }
  }

  const command = await ChatCommand.findOne({
    channelId,
    normalizedTrigger: normalizedMessage,
    enabled: true
  }).exec()

  if (!command) {
    return { matched: false }
  }

  return {
    matched: true,
    replyText: command.replyText,
    command
  }
}
