import { getOptionalEnv, getRequiredEnv } from '../../src/config/env.js'
import {
  OPENAI_CHAT_COMPLETIONS_URL,
  createChatCompletion,
  extractChatCompletionContent
} from '../../src/services/openai-service.js'
import { withTemporaryEnv } from '../helpers/env.js'

describe('getRequiredEnv', () => {
  it('returns the trimmed value when the variable is set', () => {
    process.env._TEST_REQUIRED = '  hello  '
    expect(getRequiredEnv('_TEST_REQUIRED')).toBe('hello')
    delete process.env._TEST_REQUIRED
  })

  it('throws when the variable is missing', () => {
    delete process.env._TEST_REQUIRED
    expect(() => getRequiredEnv('_TEST_REQUIRED')).toThrow(/required/)
  })
})

describe('getOptionalEnv', () => {
  it('returns the trimmed value when the variable is set', () => {
    process.env._TEST_OPTIONAL = '  world  '
    expect(getOptionalEnv('_TEST_OPTIONAL', 'fallback')).toBe('world')
    delete process.env._TEST_OPTIONAL
  })

  it('returns the fallback when the variable is missing', () => {
    delete process.env._TEST_OPTIONAL
    expect(getOptionalEnv('_TEST_OPTIONAL', 'fallback')).toBe('fallback')
  })
})

describe('extractChatCompletionContent', () => {
  it('extracts the first message content string', () => {
    expect(
      extractChatCompletionContent({
        choices: [{ message: { content: 'hello' } }]
      })
    ).toBe('hello')
  })

  it('throws when the payload is not an object', () => {
    expect(() => extractChatCompletionContent(null)).toThrow(/non-object/)
    expect(() => extractChatCompletionContent('string')).toThrow(/non-object/)
  })

  it('throws when the content is missing or empty', () => {
    expect(() =>
      extractChatCompletionContent({ choices: [{ message: {} }] })
    ).toThrow(/empty response/)
    expect(() =>
      extractChatCompletionContent({
        choices: [{ message: { content: '   ' } }]
      })
    ).toThrow(/empty response/)
  })

  it('throws when the choices array is empty', () => {
    expect(() =>
      extractChatCompletionContent({ choices: [] })
    ).toThrow(/empty response/)
  })
})

describe('createChatCompletion', () => {
  it('sends a request to the OpenAI chat completions URL with auth headers', async () => {
    const requests: Array<{
      input: Parameters<typeof fetch>[0]
      init: Parameters<typeof fetch>[1]
    }> = []
    const fetcher: typeof fetch = async (input, init) => {
      requests.push({ input, init })
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'response text' } }]
        }),
        { status: 200 }
      )
    }

    const result = await withTemporaryEnv(
      { OPENAI_API_KEY: 'test-key', OPENAI_MODEL: 'test-model' },
      () =>
        createChatCompletion({
          messages: [
            { role: 'system', content: 'You are helpful.' },
            { role: 'user', content: 'Hello' }
          ],
          fetcher
        })
    )

    expect(result).toBe('response text')
    expect(String(requests[0]?.input)).toBe(OPENAI_CHAT_COMPLETIONS_URL)

    const init = requests[0]?.init
    const headers = init?.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer test-key')
    expect(headers['Content-Type']).toBe('application/json')
  })

  it('uses the configured model and default model fallback', async () => {
    const requests: Array<{ init: Parameters<typeof fetch>[1] }> = []
    const fetcher: typeof fetch = async (_input, init) => {
      requests.push({ init })
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'ok' } }]
        }),
        { status: 200 }
      )
    }

    await withTemporaryEnv(
      { OPENAI_API_KEY: 'test-key', OPENAI_MODEL: 'custom-model' },
      () =>
        createChatCompletion({
          messages: [{ role: 'user', content: 'hi' }],
          fetcher
        })
    )
    expect(
      (JSON.parse(String(requests[0].init?.body)) as Record<string, unknown>).model
    ).toBe('custom-model')
  })

  it('falls back to the default model when OPENAI_MODEL is not set', async () => {
    const requests: Array<{ init: Parameters<typeof fetch>[1] }> = []
    const fetcher: typeof fetch = async (_input, init) => {
      requests.push({ init })
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'ok' } }]
        }),
        { status: 200 }
      )
    }

    await withTemporaryEnv({ OPENAI_API_KEY: 'test-key' }, () =>
      createChatCompletion({
        messages: [{ role: 'user', content: 'hi' }],
        fetcher
      })
    )
    expect(
      (JSON.parse(String(requests[0].init?.body)) as Record<string, unknown>).model
    ).toBe('gpt-5.4-nano')
  })

  it('passes response_format when provided', async () => {
    const requests: Array<{ init: Parameters<typeof fetch>[1] }> = []
    const fetcher: typeof fetch = async (_input, init) => {
      requests.push({ init })
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{}' } }]
        }),
        { status: 200 }
      )
    }
    const format = { type: 'json_object' } as Record<string, unknown>

    await withTemporaryEnv(
      { OPENAI_API_KEY: 'test-key', OPENAI_MODEL: 'test-model' },
      () =>
        createChatCompletion({
          messages: [{ role: 'user', content: 'test' }],
          response_format: format,
          fetcher
        })
    )

    const body = JSON.parse(String(requests[0].init?.body)) as Record<
      string,
      unknown
    >
    expect(body.response_format).toEqual(format)
  })

  it('omits response_format when not provided', async () => {
    const requests: Array<{ init: Parameters<typeof fetch>[1] }> = []
    const fetcher: typeof fetch = async (_input, init) => {
      requests.push({ init })
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'ok' } }]
        }),
        { status: 200 }
      )
    }

    await withTemporaryEnv(
      { OPENAI_API_KEY: 'test-key', OPENAI_MODEL: 'test-model' },
      () =>
        createChatCompletion({
          messages: [{ role: 'user', content: 'test' }],
          fetcher
        })
    )

    const body = JSON.parse(String(requests[0].init?.body)) as Record<
      string,
      unknown
    >
    expect(body).not.toHaveProperty('response_format')
  })

  it('throws when OpenAI returns a non-ok response', async () => {
    const fetcher: typeof fetch = async () =>
      new Response('bad request', { status: 400 })

    await expect(
      withTemporaryEnv({ OPENAI_API_KEY: 'test-key' }, () =>
        createChatCompletion({
          messages: [{ role: 'user', content: 'test' }],
          fetcher
        })
      )
    ).rejects.toThrow(/status 400/)
  })

  it('throws when OPENAI_API_KEY is missing', async () => {
    delete process.env.OPENAI_API_KEY

    await expect(
      createChatCompletion({
        messages: [{ role: 'user', content: 'test' }]
      })
    ).rejects.toThrow(/OPENAI_API_KEY/)
  })
})
