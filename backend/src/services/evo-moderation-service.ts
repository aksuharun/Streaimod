import { Raison } from 'raison'

import { getRequiredEnv } from '../config/env.js'
import {
  ModerationCategory,
  type IModerationCategoryDocument
} from '../models/moderation-category.js'
import { User } from '../models/user.js'
import { createChatCompletion, isRecord } from './openai-service.js'
import { isChannelModerationEnabled } from './google-auth-service.js'

// ─── Types ──────────────────────────────────────────────────────────────────

export type EvoModerationAction = 'BAN' | 'TIMEOUT' | 'IGNORE'

export interface EvoModerationCategoryEntry {
  category_id: string
  category_label: string
  definition: string
}

// ─── Input ──────────────────────────────────────────────────────────────────

export interface RunEvoModerationInput {
  channelId: string
  message: string
}

// ─── Prompt Variables ────────────────────────────────────────────────────────

export interface EvoModerationNormalizePromptVariables {
  messageText: string
}

export interface EvoModerationBanPromptVariables {
  channelId: string
  messageText: string
  banCategories: EvoModerationCategoryEntry[]
}

export interface EvoModerationTimeoutPromptVariables {
  channelId: string
  messageText: string
  timeoutCategories: EvoModerationCategoryEntry[]
}

// ─── Model Input ─────────────────────────────────────────────────────────────

export interface EvoModerationNormalizeModelInput {
  systemPrompt: string
  messageText: string
}

export interface EvoModerationStageModelInput {
  systemPrompt: string
  messageText: string
  stageType: 'ban' | 'timeout'
  allowedCategoryIds: string[]
}

// ─── Model Output ────────────────────────────────────────────────────────────

export interface EvoModerationStageDecision {
  action: EvoModerationAction
  categoryId: string | null
  reason: string | null
}

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface EvoModerationNormalizePromptRenderer {
  render(variables: EvoModerationNormalizePromptVariables): Promise<string>
}

export interface EvoModerationBanPromptRenderer {
  render(variables: EvoModerationBanPromptVariables): Promise<string>
}

export interface EvoModerationTimeoutPromptRenderer {
  render(variables: EvoModerationTimeoutPromptVariables): Promise<string>
}

export interface EvoModerationNormalizeModel {
  normalize(input: EvoModerationNormalizeModelInput): Promise<string>
}

export interface EvoModerationStageModel {
  decide(input: EvoModerationStageModelInput): Promise<EvoModerationStageDecision>
}

// ─── Dependencies ────────────────────────────────────────────────────────────

export interface EvoModerationDependencies {
  normalizePromptRenderer: EvoModerationNormalizePromptRenderer
  normalizeModel: EvoModerationNormalizeModel
  banPromptRenderer: EvoModerationBanPromptRenderer
  banModel: EvoModerationStageModel
  timeoutPromptRenderer: EvoModerationTimeoutPromptRenderer
  timeoutModel: EvoModerationStageModel
}

// ─── Workflow & Result ──────────────────────────────────────────────────────

export interface EvoModerationWorkflow {
  receivedMessage: true
  unicodeCount: number
  normalized: boolean
  normalizedMessage: string
  banCategoryIds: string[]
  timeoutCategoryIds: string[]
  banCategoriesCount: number
  timeoutCategoriesCount: number
  banSkipped: boolean
  timeoutSkipped: boolean
  banAction: EvoModerationAction | null
  banCatalogId: string | null
  banReason: string | null
  timeoutAction: EvoModerationAction | null
  timeoutCatalogId: string | null
  timeoutReason: string | null
}

export interface EvoModerationResult {
  agent: 'evo-moderation'
  action: EvoModerationAction
  catalogId: string | null
  reason: string | null
  stage: 'ban' | 'timeout'
  workflow: EvoModerationWorkflow
}

// ─── Utility Functions ──────────────────────────────────────────────────────

export function countUnicodeChars(text: string): number {
  let count = 0
  for (const char of text) {
    if (char.codePointAt(0)! > 127) {
      count++
    }
  }
  return count
}

function stripJsonCodeFence(output: string): string {
  const trimmed = output.trim()

  if (!trimmed.startsWith('```')) {
    return trimmed
  }

  return trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()
}

export function parseNormalizeResponse(output: string): string {
  const parsed: unknown = JSON.parse(stripJsonCodeFence(output))

  if (!isRecord(parsed)) {
    throw new Error('Normalize model returned a non-object response')
  }

  const { normalized_message } = parsed

  if (typeof normalized_message !== 'string') {
    throw new Error('Normalize model returned an invalid normalized_message')
  }

  return normalized_message
}

interface ParsedStageDecision {
  action: string
  categoryId: string
  reason: string
}

export function parseStageDecision(output: string): ParsedStageDecision {
  const parsed: unknown = JSON.parse(stripJsonCodeFence(output))

  if (!isRecord(parsed)) {
    throw new Error('Stage model returned a non-object response')
  }

  const { action, category_id, reason } = parsed

  if (typeof action !== 'string') {
    throw new Error('Stage model returned an invalid action')
  }

  if (typeof category_id !== 'string') {
    throw new Error('Stage model returned an invalid category_id')
  }

  if (typeof reason !== 'string') {
    throw new Error('Stage model returned an invalid reason')
  }

  return { action, categoryId: category_id, reason }
}

// ─── Raison Prompt Renderers ────────────────────────────────────────────────

interface RaisonPromptClient {
  render(promptId: string, variables?: Record<string, unknown>): Promise<string>
}

export class RaisonEvoModerationNormalizePromptRenderer
  implements EvoModerationNormalizePromptRenderer
{
  private client: RaisonPromptClient | null

  constructor(client?: RaisonPromptClient) {
    this.client = client ?? null
  }

  async render(variables: EvoModerationNormalizePromptVariables): Promise<string> {
    const templateVariables: Record<string, unknown> = {
      messageText: variables.messageText
    }
    const renderedPrompt = await this.getClient().render(
      getRequiredEnv('RAISON_NORMALIZE_PROMPT_ID'),
      templateVariables
    )

    if (!renderedPrompt.trim()) {
      throw new Error('Raison returned an empty Evo moderation normalize prompt')
    }

    return renderedPrompt
  }

  private getClient(): RaisonPromptClient {
    this.client ??= new Raison({ apiKey: getRequiredEnv('RAISON_API_KEY') })
    return this.client
  }
}

export class RaisonEvoModerationBanPromptRenderer
  implements EvoModerationBanPromptRenderer
{
  private client: RaisonPromptClient | null

  constructor(client?: RaisonPromptClient) {
    this.client = client ?? null
  }

  async render(variables: EvoModerationBanPromptVariables): Promise<string> {
    const templateVariables: Record<string, unknown> = {
      channelId: variables.channelId,
      messageText: variables.messageText,
      banCategories: variables.banCategories
    }
    const renderedPrompt = await this.getClient().render(
      getRequiredEnv('RAISON_BAN_PROMPT_ID'),
      templateVariables
    )

    if (!renderedPrompt.trim()) {
      throw new Error('Raison returned an empty Evo moderation ban prompt')
    }

    return renderedPrompt
  }

  private getClient(): RaisonPromptClient {
    this.client ??= new Raison({ apiKey: getRequiredEnv('RAISON_API_KEY') })
    return this.client
  }
}

export class RaisonEvoModerationTimeoutPromptRenderer
  implements EvoModerationTimeoutPromptRenderer
{
  private client: RaisonPromptClient | null

  constructor(client?: RaisonPromptClient) {
    this.client = client ?? null
  }

  async render(variables: EvoModerationTimeoutPromptVariables): Promise<string> {
    const templateVariables: Record<string, unknown> = {
      channelId: variables.channelId,
      messageText: variables.messageText,
      timeoutCategories: variables.timeoutCategories
    }
    const renderedPrompt = await this.getClient().render(
      getRequiredEnv('RAISON_TIMEOUT_PROMPT_ID'),
      templateVariables
    )

    if (!renderedPrompt.trim()) {
      throw new Error('Raison returned an empty Evo moderation timeout prompt')
    }

    return renderedPrompt
  }

  private getClient(): RaisonPromptClient {
    this.client ??= new Raison({ apiKey: getRequiredEnv('RAISON_API_KEY') })
    return this.client
  }
}

// ─── OpenAI Model Classes ────────────────────────────────────────────────────

export class OpenAIEvoModerationNormalizeModel
  implements EvoModerationNormalizeModel
{
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async normalize(input: EvoModerationNormalizeModelInput): Promise<string> {
    const content = await createChatCompletion({
      messages: [
        { role: 'system', content: input.systemPrompt },
        { role: 'user', content: input.messageText }
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'normalize_response',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              normalized_message: {
                type: 'string',
                description:
                  'ASCII-readable version of the original message with homoglyphs converted, zero-width characters removed, and spacing restored'
              }
            },
            required: ['normalized_message'],
            additionalProperties: false
          }
        }
      },
      fetcher: this.fetcher
    })

    return parseNormalizeResponse(content)
  }
}

export class OpenAIEvoModerationStageModel implements EvoModerationStageModel {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async decide(input: EvoModerationStageModelInput): Promise<EvoModerationStageDecision> {
    const actionEnum =
      input.stageType === 'ban' ? ['BAN', 'IGNORE'] : ['TIMEOUT', 'IGNORE']
    const categoryIdEnum = [...input.allowedCategoryIds, 'NONE']
    const schemaName = `${input.stageType}_response`

    const content = await createChatCompletion({
      messages: [
        { role: 'system', content: input.systemPrompt },
        { role: 'user', content: input.messageText }
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: schemaName,
          strict: true,
          schema: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: actionEnum
              },
              category_id: {
                type: 'string',
                enum: categoryIdEnum
              },
              reason: {
                type: 'string'
              }
            },
            required: ['action', 'category_id', 'reason'],
            additionalProperties: false
          }
        }
      },
      fetcher: this.fetcher
    })

    const raw = parseStageDecision(content)

    const validActions =
      input.stageType === 'ban' ? ['BAN', 'IGNORE'] : ['TIMEOUT', 'IGNORE']

    if (!validActions.includes(raw.action)) {
      return {
        action: 'IGNORE',
        categoryId: null,
        reason: `Invalid action for ${input.stageType} stage: ${raw.action}`
      }
    }

    if (raw.action === 'IGNORE') {
      return { action: 'IGNORE', categoryId: null, reason: raw.reason }
    }

    if (!input.allowedCategoryIds.includes(raw.categoryId)) {
      return {
        action: 'IGNORE',
        categoryId: null,
        reason: `Invalid category selection: ${raw.categoryId} not in enabled ${input.stageType} categories`
      }
    }

    return {
      action: raw.action as EvoModerationAction,
      categoryId: raw.categoryId,
      reason: raw.reason
    }
  }
}

// ─── Default Dependencies ────────────────────────────────────────────────────

let defaultDependencies: EvoModerationDependencies | null = null

function getDefaultEvoModerationDependencies(): EvoModerationDependencies {
  defaultDependencies ??= {
    normalizePromptRenderer: new RaisonEvoModerationNormalizePromptRenderer(),
    normalizeModel: new OpenAIEvoModerationNormalizeModel(),
    banPromptRenderer: new RaisonEvoModerationBanPromptRenderer(),
    banModel: new OpenAIEvoModerationStageModel(),
    timeoutPromptRenderer: new RaisonEvoModerationTimeoutPromptRenderer(),
    timeoutModel: new OpenAIEvoModerationStageModel()
  }

  return defaultDependencies
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toModerationCategoryEntry(
  doc: IModerationCategoryDocument
): EvoModerationCategoryEntry {
  return {
    category_id: doc.catalogId,
    category_label: doc.label,
    definition: doc.definition
  }
}

// ─── Main Workflow ───────────────────────────────────────────────────────────

export async function runEvoModerationWorkflow(
  input: RunEvoModerationInput,
  dependencies: EvoModerationDependencies = getDefaultEvoModerationDependencies()
): Promise<EvoModerationResult> {
  const channelId = input.channelId.trim()
  const message = input.message

  // 1. Count unicode characters
  const unicodeCount = countUnicodeChars(message)

  const channelOwner = await User.findOne({ channels: { $elemMatch: { channelId } } })
    .select({ channels: 1 })
    .exec()

  if (channelOwner && !isChannelModerationEnabled(channelOwner, channelId)) {
    return {
      agent: 'evo-moderation',
      action: 'IGNORE',
      catalogId: null,
      reason: 'AGENT_DISABLED',
      stage: 'timeout',
      workflow: {
        receivedMessage: true,
        unicodeCount,
        normalized: false,
        normalizedMessage: message,
        banCategoryIds: [],
        timeoutCategoryIds: [],
        banCategoriesCount: 0,
        timeoutCategoriesCount: 0,
        banSkipped: true,
        timeoutSkipped: true,
        banAction: null,
        banCatalogId: null,
        banReason: null,
        timeoutAction: 'IGNORE',
        timeoutCatalogId: null,
        timeoutReason: 'AGENT_DISABLED'
      }
    }
  }

  // 2. Normalize if unicode count > 1
  let normalizedMessage = message
  let normalized = false

  if (unicodeCount > 1) {
    const normalizeSystemPrompt = await dependencies.normalizePromptRenderer.render({
      messageText: message
    })
    normalizedMessage = await dependencies.normalizeModel.normalize({
      systemPrompt: normalizeSystemPrompt,
      messageText: message
    })
    normalized = true
  }

  // 3. Load enabled categories for the channel, grouped by type
  const categories = await ModerationCategory.find({
    channelId,
    enabled: true
  }).exec()

  const banCategories = categories
    .filter((c) => c.type === 'ban')
    .map(toModerationCategoryEntry)

  const timeoutCategories = categories
    .filter((c) => c.type === 'timeout')
    .map(toModerationCategoryEntry)

  const banCatalogIds = banCategories.map((c) => c.category_id)
  const timeoutCatalogIds = timeoutCategories.map((c) => c.category_id)

  // 4. Run ban stage
  let banAction: EvoModerationAction | null = null
  let banCategoryId: string | null = null
  let banReason: string | null = null
  let banSkipped = false

  if (banCategories.length === 0) {
    banSkipped = true
    banAction = 'IGNORE'
    banReason = 'No enabled ban categories'
  } else {
    const banSystemPrompt = await dependencies.banPromptRenderer.render({
      channelId,
      messageText: normalizedMessage,
      banCategories
    })
    const banDecision = await dependencies.banModel.decide({
      systemPrompt: banSystemPrompt,
      messageText: normalizedMessage,
      stageType: 'ban',
      allowedCategoryIds: banCatalogIds
    })
    banAction = banDecision.action
    banCategoryId = banDecision.categoryId
    banReason = banDecision.reason
  }

  // 5. If ban returned BAN, stop immediately
  if (banAction === 'BAN') {
    return {
      agent: 'evo-moderation',
      action: 'BAN',
      catalogId: banCategoryId,
      reason: banReason,
      stage: 'ban',
      workflow: {
        receivedMessage: true,
        unicodeCount,
        normalized,
        normalizedMessage,
        banCategoryIds: banCatalogIds,
        timeoutCategoryIds: timeoutCatalogIds,
        banCategoriesCount: banCategories.length,
        timeoutCategoriesCount: timeoutCategories.length,
        banSkipped,
        timeoutSkipped: true,
        banAction,
        banCatalogId: banCategoryId,
        banReason,
        timeoutAction: null,
        timeoutCatalogId: null,
        timeoutReason: null
      }
    }
  }

  // 6. Run timeout stage (ban was IGNORE)
  let timeoutAction: EvoModerationAction | null = null
  let timeoutCategoryId: string | null = null
  let timeoutReason: string | null = null
  let timeoutSkipped = false

  if (timeoutCategories.length === 0) {
    timeoutSkipped = true
    timeoutAction = 'IGNORE'
    timeoutReason = 'No enabled timeout categories'
  } else {
    const timeoutSystemPrompt = await dependencies.timeoutPromptRenderer.render(
      {
        channelId,
        messageText: normalizedMessage,
        timeoutCategories
      }
    )
    const timeoutDecision = await dependencies.timeoutModel.decide({
      systemPrompt: timeoutSystemPrompt,
      messageText: normalizedMessage,
      stageType: 'timeout',
      allowedCategoryIds: timeoutCatalogIds
    })
    timeoutAction = timeoutDecision.action
    timeoutCategoryId = timeoutDecision.categoryId
    timeoutReason = timeoutDecision.reason
  }

  // 7. Determine final result
  const finalAction: EvoModerationAction =
    timeoutAction === 'TIMEOUT' ? 'TIMEOUT' : 'IGNORE'
  const finalCategoryId =
    timeoutAction === 'TIMEOUT' ? timeoutCategoryId : null

  return {
    agent: 'evo-moderation',
    action: finalAction,
    catalogId: finalCategoryId,
    reason: timeoutReason,
    stage: 'timeout',
    workflow: {
      receivedMessage: true,
      unicodeCount,
      normalized,
      normalizedMessage,
      banCategoryIds: banCatalogIds,
      timeoutCategoryIds: timeoutCatalogIds,
      banCategoriesCount: banCategories.length,
      timeoutCategoriesCount: timeoutCategories.length,
      banSkipped,
      timeoutSkipped,
      banAction,
      banCatalogId: banCategoryId,
      banReason,
      timeoutAction,
      timeoutCatalogId: timeoutCategoryId,
      timeoutReason
    }
  }
}
