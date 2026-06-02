import { getOptionalEnv, getRequiredEnv } from '../config/env.js'

export const OPENAI_CHAT_COMPLETIONS_URL =
  'https://api.openai.com/v1/chat/completions'
export const DEFAULT_OPENAI_MODEL = 'gpt-5.4-nano'

export interface ChatCompletionMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatCompletionOptions {
  messages: ChatCompletionMessage[]
  response_format?: Record<string, unknown>
  fetcher?: typeof fetch
}

interface ChatCompletionResponseMessage {
  content?: unknown
}

interface ChatCompletionChoice {
  message?: ChatCompletionResponseMessage
}

interface ChatCompletionResponse {
  choices?: ChatCompletionChoice[]
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function extractChatCompletionContent(payload: unknown): string {
  if (!isRecord(payload)) {
    throw new Error('OpenAI returned a non-object response')
  }

  const response = payload as ChatCompletionResponse
  const content = response.choices?.[0]?.message?.content

  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new Error('OpenAI returned an empty response')
  }

  return content
}

export async function createChatCompletion(
  options: ChatCompletionOptions
): Promise<string> {
  const fetcher = options.fetcher ?? fetch
  const apiKey = getRequiredEnv('OPENAI_API_KEY')
  const model = getOptionalEnv('OPENAI_MODEL', DEFAULT_OPENAI_MODEL)

  const response = await fetcher(OPENAI_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages: options.messages,
      ...(options.response_format
        ? { response_format: options.response_format }
        : {})
    })
  })

  if (!response.ok) {
    throw new Error(
      `OpenAI request failed with status ${response.status}: ${await response.text()}`
    )
  }

  return extractChatCompletionContent((await response.json()) as unknown)
}
