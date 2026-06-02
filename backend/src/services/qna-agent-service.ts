import { Raison } from 'raison'

import { getRequiredEnv } from '../config/env.js'
import { QnaEntry, type IQnaEntryDocument } from '../models/qna-entry.js'
import { User } from '../models/user.js'
import { createChatCompletion, isRecord } from './openai-service.js'
import { isChannelQnaEnabled } from './google-auth-service.js'
import { normalizeQuestionText } from './qna-service.js'

export type QnaAgentAction = 'SEND_ANSWER' | 'DO_NOTHING'
export type QnaAgentReason =
  | 'ANSWER_FOUND'
  | 'NO_DATABASE_MATCH'
  | 'INVALID_AGENT_SELECTION'
  | 'AGENT_DISABLED'
  | 'HISTORY_SKIPPED'

export interface RunQnaAgentInput {
  channelId: string
  messageText: string
}

export interface QnaAgentPromptEntry {
  id: string
  question: string
  answer: string
}

export interface QnaPromptVariables {
  channelId: string
  messageText: string
  qnaEntries: QnaAgentPromptEntry[]
}

export interface QnaAgentModelInput {
  systemPrompt: string
  messageText: string
  qnaEntries: QnaAgentPromptEntry[]
}

export interface QnaAgentModelDecision {
  question: string
  response: string
}

export interface QnaPromptRenderer {
  render(variables: QnaPromptVariables): Promise<string>
}

export interface QnaAgentModel {
  decide(input: QnaAgentModelInput): Promise<QnaAgentModelDecision>
}

export interface QnaAgentDependencies {
  promptRenderer: QnaPromptRenderer
  model: QnaAgentModel
}

export interface QnaAgentWorkflow {
  receivedMessage: true
  retrievedEntries: number
  retrievedQnaEntries: QnaAgentPromptEntry[]
  normalizedMessage: string
  promptRendered: boolean
  decision: QnaAgentAction
  reason: QnaAgentReason
  selectedEntryId?: string
}

interface QnaAgentBaseResult {
  agent: 'qna'
  workflow: QnaAgentWorkflow
}

export interface QnaAgentAnswerResult extends QnaAgentBaseResult {
  matched: true
  action: 'SEND_ANSWER'
  answer: string
  entry: IQnaEntryDocument
}

export interface QnaAgentDoNothingResult extends QnaAgentBaseResult {
  matched: false
  action: 'DO_NOTHING'
  answer?: never
  entry?: never
}

export type QnaAgentResult = QnaAgentAnswerResult | QnaAgentDoNothingResult

interface RaisonPromptClient {
  render(promptId: string, variables?: Record<string, unknown>): Promise<string>
}

function toPromptEntry(entry: IQnaEntryDocument): QnaAgentPromptEntry {
  return {
    id: String(entry._id),
    question: entry.question,
    answer: entry.answer
  }
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

export function parseQnaAgentDecision(output: string): QnaAgentModelDecision {
  const parsed: unknown = JSON.parse(stripJsonCodeFence(output))

  if (!isRecord(parsed)) {
    throw new Error('Q&A agent returned a non-object response')
  }

  if (typeof parsed.question !== 'string') {
    throw new Error('Q&A agent returned an invalid question')
  }

  if (typeof parsed.response !== 'string') {
    throw new Error('Q&A agent returned an invalid response')
  }

  return { question: parsed.question, response: parsed.response }
}

export class RaisonQnaPromptRenderer implements QnaPromptRenderer {
  private client: RaisonPromptClient | null

  constructor(client?: RaisonPromptClient) {
    this.client = client ?? null
  }

  async render(variables: QnaPromptVariables): Promise<string> {
    const templateVariables: Record<string, unknown> = {
      channelId: variables.channelId,
      messageText: variables.messageText,
      qnaEntries: variables.qnaEntries
    }
    const renderedPrompt = await this.getClient().render(
      getRequiredEnv('RAISON_QNA_PROMPT_ID'),
      templateVariables
    )

    if (!renderedPrompt.trim()) {
      throw new Error('Raison returned an empty Q&A agent prompt')
    }

    return renderedPrompt
  }

  private getClient(): RaisonPromptClient {
    this.client ??= new Raison({ apiKey: getRequiredEnv('RAISON_API_KEY') })
    return this.client
  }
}

export class OpenAIQnaAgentModel implements QnaAgentModel {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async decide(input: QnaAgentModelInput): Promise<QnaAgentModelDecision> {
    const qnaEntriesSystemMessage: string[] = [
      '{',
      '  "description": "Q&A database entries retrieved for this channel, provided as structured data alongside the rendered prompt.",',
      '  "entries": ' + JSON.stringify(input.qnaEntries),
      '}'
    ]

    const content = await createChatCompletion({
      messages: [
        { role: 'system', content: input.systemPrompt },
        { role: 'system', content: qnaEntriesSystemMessage.join('\n') },
        { role: 'user', content: input.messageText }
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'question_response',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              question: {
                type: 'string',
                description: "User's questions."
              },
              response: {
                type: 'string',
                description:
                  'Final response. Empty string if no response required.'
              }
            },
            required: ['question', 'response']
          }
        }
      },
      fetcher: this.fetcher
    })

    const decision = parseQnaAgentDecision(content)

    return decision
  }
}

let defaultDependencies: QnaAgentDependencies | null = null

function getDefaultQnaAgentDependencies(): QnaAgentDependencies {
  defaultDependencies ??= {
    promptRenderer: new RaisonQnaPromptRenderer(),
    model: new OpenAIQnaAgentModel()
  }

  return defaultDependencies
}

function buildDoNothingResult(
  workflow: Omit<QnaAgentWorkflow, 'decision' | 'reason'>,
  reason: Exclude<QnaAgentReason, 'ANSWER_FOUND'>
): QnaAgentResult {
  return {
    agent: 'qna',
    matched: false,
    action: 'DO_NOTHING',
    workflow: {
      ...workflow,
      decision: 'DO_NOTHING',
      reason
    }
  }
}

export async function runQnaAgentWorkflow(
  input: RunQnaAgentInput,
  dependencies: QnaAgentDependencies = getDefaultQnaAgentDependencies()
): Promise<QnaAgentResult> {
  const channelId = input.channelId.trim()
  const normalizedMessage = normalizeQuestionText(input.messageText)

  const channelOwner = await User.findOne({ channels: { $elemMatch: { channelId } } })
    .select({ channels: 1 })
    .exec()

  if (channelOwner && !isChannelQnaEnabled(channelOwner, channelId)) {
    return buildDoNothingResult(
      {
        receivedMessage: true,
        retrievedEntries: 0,
        retrievedQnaEntries: [],
        normalizedMessage,
        promptRendered: false
      },
      'AGENT_DISABLED'
    )
  }

  const entries = await QnaEntry.find({
    channelId,
    enabled: true
  })
    .sort({ createdAt: -1 })
    .exec()

  const qnaEntries = entries.map(toPromptEntry)
  const systemPrompt = await dependencies.promptRenderer.render({
    channelId,
    messageText: input.messageText,
    qnaEntries
  })
  const decision = await dependencies.model.decide({
    systemPrompt,
    messageText: input.messageText,
    qnaEntries
  })

  const responseText = decision.response.trim()
  const matchedQuestion = decision.question.trim()
  const normalizedMatchQuestion = normalizeQuestionText(matchedQuestion)
  const selectedEntryByQuestion = normalizedMatchQuestion
    ? entries.find(
        (entry) =>
          normalizeQuestionText(entry.question) === normalizedMatchQuestion
      )
    : undefined
  const entriesMatchingResponse = responseText.length
    ? entries.filter((entry) => entry.answer.trim() === responseText)
    : []
  const selectedEntry =
    selectedEntryByQuestion ??
    (entriesMatchingResponse.length === 1 ? entriesMatchingResponse[0] : undefined)
  const baseWorkflow = {
    receivedMessage: true as const,
    retrievedEntries: entries.length,
    retrievedQnaEntries: qnaEntries,
    normalizedMessage,
    promptRendered: true as const,
    selectedEntryId: selectedEntry ? String(selectedEntry._id) : undefined
  }

  if (responseText.length > 0 && selectedEntry) {
    return {
      agent: 'qna',
      matched: true,
      action: 'SEND_ANSWER',
      answer: selectedEntry.answer,
      entry: selectedEntry,
      workflow: {
        ...baseWorkflow,
        decision: 'SEND_ANSWER',
        reason: 'ANSWER_FOUND'
      }
    }
  }

  const doNothingReason: Exclude<QnaAgentReason, 'ANSWER_FOUND'> =
    matchedQuestion.length > 0 ? 'INVALID_AGENT_SELECTION' : 'NO_DATABASE_MATCH'

  return buildDoNothingResult(baseWorkflow, doNothingReason)
}
