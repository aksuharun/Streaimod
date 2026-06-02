import { ModerationCategory } from '../../src/models/moderation-category.js'
import { User } from '../../src/models/user.js'
import {
  countUnicodeChars,
  OpenAIEvoModerationNormalizeModel,
  OpenAIEvoModerationStageModel,
  parseNormalizeResponse,
  parseStageDecision,
  RaisonEvoModerationBanPromptRenderer,
  RaisonEvoModerationNormalizePromptRenderer,
  RaisonEvoModerationTimeoutPromptRenderer,
  runEvoModerationWorkflow,
  type EvoModerationBanPromptVariables,
  type EvoModerationDependencies,
  type EvoModerationNormalizeModelInput,
  type EvoModerationNormalizePromptVariables,
  type EvoModerationStageDecision,
  type EvoModerationStageModelInput,
  type EvoModerationTimeoutPromptVariables
} from '../../src/services/evo-moderation-service.js'
import { withTemporaryEnv } from '../helpers/env.js'
import {
  clearTestDatabase,
  registerTestModel
} from '../helpers/test-database.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createModerationDependencies(overrides?: {
  normalizeResult?: string
  banDecide?: (
    input: EvoModerationStageModelInput
  ) => EvoModerationStageDecision | Promise<EvoModerationStageDecision>
  timeoutDecide?: (
    input: EvoModerationStageModelInput
  ) => EvoModerationStageDecision | Promise<EvoModerationStageDecision>
}) {
  const normalizeRender = vi.fn(
    async (_variables: EvoModerationNormalizePromptVariables) =>
      'rendered normalize prompt'
  )
  const normalizeModel = vi.fn(
    async (_input: EvoModerationNormalizeModelInput) =>
      overrides?.normalizeResult ?? 'normalized text'
  )
  const banRender = vi.fn(
    async (_variables: EvoModerationBanPromptVariables) =>
      'rendered ban prompt'
  )
  const banDecide = vi.fn(async (input: EvoModerationStageModelInput) =>
    overrides?.banDecide
      ? overrides.banDecide(input)
      : { action: 'IGNORE' as const, categoryId: null, reason: 'No violation' }
  )
  const timeoutRender = vi.fn(
    async (_variables: EvoModerationTimeoutPromptVariables) =>
      'rendered timeout prompt'
  )
  const timeoutDecide = vi.fn(async (input: EvoModerationStageModelInput) =>
    overrides?.timeoutDecide
      ? overrides.timeoutDecide(input)
      : {
          action: 'IGNORE' as const,
          categoryId: null,
          reason: 'No violation'
        }
  )

  const dependencies: EvoModerationDependencies = {
    normalizePromptRenderer: { render: normalizeRender },
    normalizeModel: {
      normalize: async (input) => normalizeModel(input)
    },
    banPromptRenderer: { render: banRender },
    banModel: { decide: banDecide },
    timeoutPromptRenderer: { render: timeoutRender },
    timeoutModel: { decide: timeoutDecide }
  }

  return {
    dependencies,
    normalizeRender,
    normalizeModel,
    banRender,
    banDecide,
    timeoutRender,
    timeoutDecide
  }
}

// ─── countUnicodeChars ──────────────────────────────────────────────────────

describe('countUnicodeChars', () => {
  it('returns 0 for pure ASCII text', () => {
    expect(countUnicodeChars('Hello world')).toBe(0)
  })

  it('counts non-ASCII characters correctly', () => {
    expect(countUnicodeChars('Kaç yaşındasın')).toBe(4) // ç, ş, ı, ı
  })

  it('counts emoji as single characters', () => {
    expect(countUnicodeChars('Hello 🎉🎊')).toBe(2)
  })

  it('returns 0 for empty string', () => {
    expect(countUnicodeChars('')).toBe(0)
  })

  it('counts multiple non-ASCII characters', () => {
    expect(countUnicodeChars('你好世界')).toBe(4)
  })
})

// ─── parseNormalizeResponse ──────────────────────────────────────────────────

describe('parseNormalizeResponse', () => {
  it('parses a valid normalize response', () => {
    expect(
      parseNormalizeResponse(
        JSON.stringify({ normalized_message: 'Hello world' })
      )
    ).toBe('Hello world')
  })

  it('parses a fenced JSON response', () => {
    expect(
      parseNormalizeResponse(
        '```json\n{"normalized_message":"Hello world"}\n```'
      )
    ).toBe('Hello world')
  })

  it('rejects a non-object response', () => {
    expect(() => parseNormalizeResponse('"not an object"')).toThrow(
      /non-object/
    )
  })

  it('rejects a response with missing normalized_message', () => {
    expect(() =>
      parseNormalizeResponse(JSON.stringify({ other_field: 'test' }))
    ).toThrow(/invalid normalized_message/)
  })
})

// ─── parseStageDecision ─────────────────────────────────────────────────────

describe('parseStageDecision', () => {
  it('parses a valid ban decision', () => {
    const result = parseStageDecision(
      JSON.stringify({
        action: 'BAN',
        category_id: 'SCAM',
        reason: 'Phishing attempt detected'
      })
    )

    expect(result).toEqual({
      action: 'BAN',
      categoryId: 'SCAM',
      reason: 'Phishing attempt detected'
    })
  })

  it('parses a valid timeout decision', () => {
    const result = parseStageDecision(
      JSON.stringify({
        action: 'TIMEOUT',
        category_id: 'INSULT',
        reason: 'Direct name-calling'
      })
    )

    expect(result).toEqual({
      action: 'TIMEOUT',
      categoryId: 'INSULT',
      reason: 'Direct name-calling'
    })
  })

  it('parses an IGNORE decision', () => {
    const result = parseStageDecision(
      JSON.stringify({
        action: 'IGNORE',
        category_id: 'NONE',
        reason: 'No violation detected'
      })
    )

    expect(result).toEqual({
      action: 'IGNORE',
      categoryId: 'NONE',
      reason: 'No violation detected'
    })
  })

  it('rejects a non-object response', () => {
    expect(() => parseStageDecision('"not an object"')).toThrow(
      /non-object/
    )
  })

  it('rejects a response with non-string action', () => {
    expect(() =>
      parseStageDecision(
        JSON.stringify({ action: 42, category_id: 'SCAM', reason: 'test' })
      )
    ).toThrow(/invalid action/)
  })

  it('rejects a response with non-string category_id', () => {
    expect(() =>
      parseStageDecision(
        JSON.stringify({ action: 'BAN', category_id: 123, reason: 'test' })
      )
    ).toThrow(/invalid category_id/)
  })

  it('rejects a response with non-string reason', () => {
    expect(() =>
      parseStageDecision(
        JSON.stringify({ action: 'BAN', category_id: 'SCAM', reason: 42 })
      )
    ).toThrow(/invalid reason/)
  })
})

// ─── RaisonEvoModerationPromptRenderers ─────────────────────────────────────

describe('RaisonEvoModerationNormalizePromptRenderer', () => {
  it('renders the normalize prompt through Raison with the configured prompt ID', async () => {
    const render = vi.fn(async () => 'rendered normalize prompt')
    const renderer = new RaisonEvoModerationNormalizePromptRenderer({
      render
    })
    const variables: EvoModerationNormalizePromptVariables = {
      messageText: 'Kаç yaşındasın'
    }

    const result = await withTemporaryEnv(
      { RAISON_NORMALIZE_PROMPT_ID: 'normalize-prompt-1' },
      () => renderer.render(variables)
    )

    expect(result).toBe('rendered normalize prompt')
    expect(render).toHaveBeenCalledWith('normalize-prompt-1', variables)
  })

  it('rejects an empty rendered normalize prompt', async () => {
    const renderer = new RaisonEvoModerationNormalizePromptRenderer({
      render: vi.fn(async () => '   ')
    })

    await expect(
      withTemporaryEnv(
        { RAISON_NORMALIZE_PROMPT_ID: 'normalize-prompt-1' },
        () =>
          renderer.render({
            messageText: 'Hello'
          })
      )
    ).rejects.toThrow(/empty Evo moderation normalize prompt/)
  })
})

describe('RaisonEvoModerationBanPromptRenderer', () => {
  it('renders the ban prompt through Raison with categories', async () => {
    const render = vi.fn(async () => 'rendered ban prompt')
    const renderer = new RaisonEvoModerationBanPromptRenderer({ render })
    const variables: EvoModerationBanPromptVariables = {
      channelId: 'ch-1',
      messageText: 'Free giveaway',
      banCategories: [
        {
          category_id: 'SCAM',
          category_label: 'Scam or phishing',
          definition: 'Scam definition'
        }
      ]
    }

    const result = await withTemporaryEnv(
      { RAISON_BAN_PROMPT_ID: 'ban-prompt-1' },
      () => renderer.render(variables)
    )

    expect(result).toBe('rendered ban prompt')
    expect(render).toHaveBeenCalledWith('ban-prompt-1', {
      channelId: 'ch-1',
      messageText: 'Free giveaway',
      banCategories: [
        {
          category_id: 'SCAM',
          category_label: 'Scam or phishing',
          definition: 'Scam definition'
        }
      ]
    })
  })

  it('rejects an empty rendered ban prompt', async () => {
    const renderer = new RaisonEvoModerationBanPromptRenderer({
      render: vi.fn(async () => '  ')
    })

    await expect(
      withTemporaryEnv(
        { RAISON_BAN_PROMPT_ID: 'ban-prompt-1' },
        () =>
          renderer.render({
            channelId: 'ch-1',
            messageText: 'Hello',
            banCategories: []
          })
      )
    ).rejects.toThrow(/empty Evo moderation ban prompt/)
  })
})

describe('RaisonEvoModerationTimeoutPromptRenderer', () => {
  it('renders the timeout prompt through Raison with categories', async () => {
    const render = vi.fn(async () => 'rendered timeout prompt')
    const renderer = new RaisonEvoModerationTimeoutPromptRenderer({ render })
    const variables: EvoModerationTimeoutPromptVariables = {
      channelId: 'ch-1',
      messageText: 'You are an idiot',
      timeoutCategories: [
        {
          category_id: 'INSULT',
          category_label: 'Insult',
          definition: 'Direct insults'
        }
      ]
    }

    const result = await withTemporaryEnv(
      { RAISON_TIMEOUT_PROMPT_ID: 'timeout-prompt-1' },
      () => renderer.render(variables)
    )

    expect(result).toBe('rendered timeout prompt')
    expect(render).toHaveBeenCalledWith('timeout-prompt-1', {
      channelId: 'ch-1',
      messageText: 'You are an idiot',
      timeoutCategories: [
        {
          category_id: 'INSULT',
          category_label: 'Insult',
          definition: 'Direct insults'
        }
      ]
    })
  })

  it('rejects an empty rendered timeout prompt', async () => {
    const renderer = new RaisonEvoModerationTimeoutPromptRenderer({
      render: vi.fn(async () => '  ')
    })

    await expect(
      withTemporaryEnv(
        { RAISON_TIMEOUT_PROMPT_ID: 'timeout-prompt-1' },
        () =>
          renderer.render({
            channelId: 'ch-1',
            messageText: 'Hello',
            timeoutCategories: []
          })
      )
    ).rejects.toThrow(/empty Evo moderation timeout prompt/)
  })
})

// ─── OpenAIEvoModerationNormalizeModel ───────────────────────────────────────

describe('OpenAIEvoModerationNormalizeModel', () => {
  it('calls OpenAI and parses the normalized message', async () => {
    const fetcher: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  normalized_message: 'Kac yasindasin'
                })
              }
            }
          ]
        }),
        { status: 200 }
      )
    const model = new OpenAIEvoModerationNormalizeModel(fetcher)

    const result = await withTemporaryEnv(
      { OPENAI_API_KEY: 'test-openai-key' },
      () =>
        model.normalize({
          systemPrompt: 'Normalize this text',
          messageText: 'Kаç yaşındasın'
        })
    )

    expect(result).toBe('Kac yasindasin')
  })

  it('throws when OpenAI rejects the normalize request', async () => {
    const fetcher: typeof fetch = async () =>
      new Response('bad request', { status: 400 })
    const model = new OpenAIEvoModerationNormalizeModel(fetcher)

    await expect(
      withTemporaryEnv({ OPENAI_API_KEY: 'test-openai-key' }, () =>
        model.normalize({
          systemPrompt: 'Normalize',
          messageText: 'Hello'
        })
      )
    ).rejects.toThrow(/status 400/)
  })
})

// ─── OpenAIEvoModerationStageModel ───────────────────────────────────────────

describe('OpenAIEvoModerationStageModel', () => {
  it('sends a ban request to OpenAI with dynamic category enum and parses the decision', async () => {
    const requests: Array<{ init: Parameters<typeof fetch>[1] }> = []
    const fetcher: typeof fetch = async (_input, init) => {
      requests.push({ init })
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  action: 'BAN',
                  category_id: 'SCAM',
                  reason: 'Phishing attempt'
                })
              }
            }
          ]
        }),
        { status: 200 }
      )
    }
    const model = new OpenAIEvoModerationStageModel(fetcher)

    const result = await withTemporaryEnv(
      { OPENAI_API_KEY: 'test-openai-key' },
      () =>
        model.decide({
          systemPrompt: 'Ban prompt',
          messageText: 'Free giveaway',
          stageType: 'ban',
          allowedCategoryIds: ['SCAM', 'THREAT']
        })
    )

    expect(result).toEqual({
      action: 'BAN',
      categoryId: 'SCAM',
      reason: 'Phishing attempt'
    })

    const body = JSON.parse(
      String(requests[0]?.init?.body)
    ) as Record<string, unknown>
    const format = body.response_format as Record<string, unknown>
    expect(format.type).toBe('json_schema')

    const jsonSchema = format.json_schema as Record<string, unknown>
    expect(jsonSchema.name).toBe('reason_action')
    expect(jsonSchema.strict).toBe(true)

    const schema = (jsonSchema as Record<string, unknown>)
      .schema as Record<string, unknown>
    const properties = schema.properties as Record<string, unknown>
    const reasonProp = properties.reason as Record<string, unknown>
    const actionProp = properties.action as Record<string, unknown>
    const categoryIdProp = properties.category_id as Record<string, unknown>

    expect(reasonProp.description).toBe(
      'A description explaining why the action occurred.'
    )
    expect(reasonProp.minLength).toBe(1)
    expect(categoryIdProp.description).toBe(
      'Unique identifier for the category.'
    )
    expect(categoryIdProp.minLength).toBe(1)
    expect(actionProp.description).toBe(
      'The action taken, either BAN or IGNORE.'
    )
    expect(actionProp.enum).toEqual(['BAN', 'IGNORE'])
  })

  it('sends a timeout request with TIMEOUT action enum', async () => {
    const requests: Array<{ init?: RequestInit }> = []
    const fetcher: typeof fetch = async (_input, init) => {
      requests.push({ init })
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  action: 'TIMEOUT',
                  category_id: 'INSULT',
                  reason: 'Name-calling'
                })
              }
            }
          ]
        }),
        { status: 200 }
      )
    }
    const model = new OpenAIEvoModerationStageModel(fetcher)

    const result = await withTemporaryEnv(
      { OPENAI_API_KEY: 'test-openai-key' },
      () =>
        model.decide({
          systemPrompt: 'Timeout prompt',
          messageText: 'You are an idiot',
          stageType: 'timeout',
          allowedCategoryIds: ['INSULT', 'TROLLING']
        })
    )

    expect(result).toEqual({
      action: 'TIMEOUT',
      categoryId: 'INSULT',
      reason: 'Name-calling'
    })

    const body = JSON.parse(
      String(requests[0]?.init?.body)
    ) as Record<string, unknown>
    const format = body.response_format as Record<string, unknown>
    const jsonSchema = format.json_schema as Record<string, unknown>
    const schema = jsonSchema.schema as Record<string, unknown>
    const properties = schema.properties as Record<string, unknown>
    const actionProp = properties.action as Record<string, unknown>

    expect(jsonSchema.name).toBe('reason_action')
    expect(actionProp.description).toBe(
      'The action taken, either TIMEOUT or IGNORE.'
    )
    expect(actionProp.enum).toEqual(['TIMEOUT', 'IGNORE'])
  })

  it('converts invalid action to IGNORE', async () => {
    const fetcher: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  action: 'TIMEOUT',
                  category_id: 'INSULT',
                  reason: 'Test'
                })
              }
            }
          ]
        }),
        { status: 200 }
      )
    const model = new OpenAIEvoModerationStageModel(fetcher)

    const result = await withTemporaryEnv(
      { OPENAI_API_KEY: 'test-openai-key' },
      () =>
        model.decide({
          systemPrompt: 'Ban prompt',
          messageText: 'Hello',
          stageType: 'ban',
          allowedCategoryIds: ['SCAM']
        })
    )

    expect(result).toEqual({
      action: 'IGNORE',
      categoryId: null,
      reason: 'Invalid action for ban stage: TIMEOUT'
    })
  })

  it('converts invalid category selection to IGNORE', async () => {
    const fetcher: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  action: 'BAN',
                  category_id: 'MALWARE',
                  reason: 'Dangerous download'
                })
              }
            }
          ]
        }),
        { status: 200 }
      )
    const model = new OpenAIEvoModerationStageModel(fetcher)

    const result = await withTemporaryEnv(
      { OPENAI_API_KEY: 'test-openai-key' },
      () =>
        model.decide({
          systemPrompt: 'Ban prompt',
          messageText: 'Download this file',
          stageType: 'ban',
          allowedCategoryIds: ['SCAM', 'THREAT']
        })
    )

    expect(result).toEqual({
      action: 'IGNORE',
      categoryId: null,
      reason: 'Invalid category selection: MALWARE not in enabled ban categories'
    })
  })

  it('returns IGNORE when the model returns IGNORE', async () => {
    const fetcher: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  action: 'IGNORE',
                  category_id: 'NONE',
                  reason: 'No violation'
                })
              }
            }
          ]
        }),
        { status: 200 }
      )
    const model = new OpenAIEvoModerationStageModel(fetcher)

    const result = await withTemporaryEnv(
      { OPENAI_API_KEY: 'test-openai-key' },
      () =>
        model.decide({
          systemPrompt: 'Ban prompt',
          messageText: 'Hello world',
          stageType: 'ban',
          allowedCategoryIds: ['SCAM']
        })
    )

    expect(result).toEqual({
      action: 'IGNORE',
      categoryId: null,
      reason: 'No violation'
    })
  })
})

// ─── runEvoModerationWorkflow ───────────────────────────────────────────────

describe('runEvoModerationWorkflow', () => {
  beforeAll(() => {
    registerTestModel(ModerationCategory)
    registerTestModel(User)
  })

  beforeEach(async () => {
    await clearTestDatabase()
  })

  it('does not normalize when unicode count is 0 (pure ASCII)', async () => {
    const { dependencies, normalizeRender } = createModerationDependencies()
    await ModerationCategory.create({
      channelId: 'ch-1',
      catalogId: 'SCAM',
      type: 'ban',
      label: 'Scam',
      normalizedLabel: 'scam',
      definition: 'Scam definition',
      enabled: true
    })

    await runEvoModerationWorkflow(
      { channelId: 'ch-1', message: 'Hello world' },
      dependencies
    )

    expect(normalizeRender).not.toHaveBeenCalled()
  })

  it('does not normalize when unicode count is exactly 1', async () => {
    const { dependencies, normalizeRender } = createModerationDependencies()
    await ModerationCategory.create({
      channelId: 'ch-1',
      catalogId: 'SCAM',
      type: 'ban',
      label: 'Scam',
      normalizedLabel: 'scam',
      definition: 'Scam definition',
      enabled: true
    })

    await runEvoModerationWorkflow(
      { channelId: 'ch-1', message: 'Hello çorld' },
      dependencies
    )

    expect(normalizeRender).not.toHaveBeenCalled()
  })

  it('normalizes when unicode count is greater than 1', async () => {
    const { dependencies, normalizeRender, banDecide } =
      createModerationDependencies({
        banDecide: () => ({
          action: 'BAN' as const,
          categoryId: 'SCAM',
          reason: 'Phishing'
        })
      })
    await ModerationCategory.create({
      channelId: 'ch-1',
      catalogId: 'SCAM',
      type: 'ban',
      label: 'Scam',
      normalizedLabel: 'scam',
      definition: 'Scam definition',
      enabled: true
    })

    const result = await runEvoModerationWorkflow(
      { channelId: 'ch-1', message: 'Kaç yaşındasın' },
      dependencies
    )

    expect(normalizeRender).toHaveBeenCalledWith({
      messageText: 'Kaç yaşındasın'
    })
    expect(banDecide).toHaveBeenCalledWith(
      expect.objectContaining({
        messageText: 'normalized text'
      })
    )
    expect(result.workflow.normalized).toBe(true)
    expect(result.workflow.unicodeCount).toBe(4)
  })

  it('uses original message for stages when no normalization occurs', async () => {
    const { dependencies, banDecide } = createModerationDependencies({
      banDecide: () => ({
        action: 'BAN' as const,
        categoryId: 'SCAM',
        reason: 'Phishing'
      })
    })
    await ModerationCategory.create({
      channelId: 'ch-1',
      catalogId: 'SCAM',
      type: 'ban',
      label: 'Scam',
      normalizedLabel: 'scam',
      definition: 'Scam definition',
      enabled: true
    })

    const result = await runEvoModerationWorkflow(
      { channelId: 'ch-1', message: 'Free giveaway' },
      dependencies
    )

    expect(result.workflow.normalized).toBe(false)
    expect(result.workflow.normalizedMessage).toBe('Free giveaway')
    expect(banDecide).toHaveBeenCalledWith(
      expect.objectContaining({ messageText: 'Free giveaway' })
    )
  })

  it('short-circuits on ban and skips timeout', async () => {
    const { dependencies, banRender, banDecide, timeoutRender, timeoutDecide } =
      createModerationDependencies({
        banDecide: () => ({
          action: 'BAN' as const,
          categoryId: 'SCAM',
          reason: 'Phishing detected'
        })
      })
    await ModerationCategory.create({
      channelId: 'ch-1',
      catalogId: 'SCAM',
      type: 'ban',
      label: 'Scam',
      normalizedLabel: 'scam',
      definition: 'Scam definition',
      enabled: true
    })
    await ModerationCategory.create({
      channelId: 'ch-1',
      catalogId: 'INSULT',
      type: 'timeout',
      label: 'Insult',
      normalizedLabel: 'insult',
      definition: 'Direct insults',
      enabled: true
    })

    const result = await runEvoModerationWorkflow(
      { channelId: 'ch-1', message: 'Free giveaway link' },
      dependencies
    )

    expect(result).toMatchObject({
      agent: 'evo-moderation',
      action: 'BAN',
      catalogId: 'SCAM',
      reason: 'Phishing detected',
      stage: 'ban'
    })
    expect(banRender).toHaveBeenCalledTimes(1)
    expect(banDecide).toHaveBeenCalledTimes(1)
    expect(timeoutRender).not.toHaveBeenCalled()
    expect(timeoutDecide).not.toHaveBeenCalled()
    expect(result.workflow).toMatchObject({
      banSkipped: false,
      timeoutSkipped: true,
      banAction: 'BAN',
      timeoutAction: null
    })
  })

  it('runs timeout when ban returns IGNORE', async () => {
    const { dependencies, timeoutDecide } = createModerationDependencies({
      banDecide: () => ({
        action: 'IGNORE' as const,
        categoryId: null,
        reason: 'No ban violation'
      }),
      timeoutDecide: () => ({
        action: 'TIMEOUT' as const,
        categoryId: 'INSULT',
        reason: 'Direct name-calling'
      })
    })
    await ModerationCategory.create({
      channelId: 'ch-1',
      catalogId: 'SCAM',
      type: 'ban',
      label: 'Scam',
      normalizedLabel: 'scam',
      definition: 'Scam definition',
      enabled: true
    })
    await ModerationCategory.create({
      channelId: 'ch-1',
      catalogId: 'INSULT',
      type: 'timeout',
      label: 'Insult',
      normalizedLabel: 'insult',
      definition: 'Direct insults',
      enabled: true
    })

    const result = await runEvoModerationWorkflow(
      { channelId: 'ch-1', message: 'You are an idiot' },
      dependencies
    )

    expect(result).toMatchObject({
      action: 'TIMEOUT',
      catalogId: 'INSULT',
      reason: 'Direct name-calling',
      stage: 'timeout'
    })
    expect(timeoutDecide).toHaveBeenCalledTimes(1)
    expect(result.workflow).toMatchObject({
      banAction: 'IGNORE',
      timeoutAction: 'TIMEOUT',
      banSkipped: false,
      timeoutSkipped: false
    })
  })

  it('returns IGNORE when both stages return IGNORE', async () => {
    const { dependencies } = createModerationDependencies({
      banDecide: () => ({
        action: 'IGNORE' as const,
        categoryId: null,
        reason: 'No violation'
      }),
      timeoutDecide: () => ({
        action: 'IGNORE' as const,
        categoryId: null,
        reason: 'No violation'
      })
    })
    await ModerationCategory.create({
      channelId: 'ch-1',
      catalogId: 'SCAM',
      type: 'ban',
      label: 'Scam',
      normalizedLabel: 'scam',
      definition: 'Scam definition',
      enabled: true
    })
    await ModerationCategory.create({
      channelId: 'ch-1',
      catalogId: 'INSULT',
      type: 'timeout',
      label: 'Insult',
      normalizedLabel: 'insult',
      definition: 'Direct insults',
      enabled: true
    })

    const result = await runEvoModerationWorkflow(
      { channelId: 'ch-1', message: 'Hello world' },
      dependencies
    )

    expect(result).toMatchObject({
      action: 'IGNORE',
      catalogId: null,
      stage: 'timeout'
    })
  })

  it('skips ban stage when no ban categories are enabled', async () => {
    const { dependencies, banRender, banDecide } = createModerationDependencies({
      timeoutDecide: () => ({
        action: 'TIMEOUT' as const,
        categoryId: 'INSULT',
        reason: 'Name-calling'
      })
    })
    await ModerationCategory.create({
      channelId: 'ch-1',
      catalogId: 'INSULT',
      type: 'timeout',
      label: 'Insult',
      normalizedLabel: 'insult',
      definition: 'Direct insults',
      enabled: true
    })

    const result = await runEvoModerationWorkflow(
      { channelId: 'ch-1', message: 'You are an idiot' },
      dependencies
    )

    expect(banRender).not.toHaveBeenCalled()
    expect(banDecide).not.toHaveBeenCalled()
    expect(result.workflow).toMatchObject({
      banSkipped: true,
      banAction: 'IGNORE',
      banReason: 'No enabled ban categories',
      banCategoriesCount: 0,
      timeoutCategoriesCount: 1
    })
    expect(result).toMatchObject({
      action: 'TIMEOUT',
      stage: 'timeout'
    })
  })

  it('skips timeout stage when no timeout categories are enabled', async () => {
    const { dependencies, timeoutRender, timeoutDecide } =
      createModerationDependencies({
        banDecide: () => ({
          action: 'IGNORE' as const,
          categoryId: null,
          reason: 'No ban violation'
        })
      })
    await ModerationCategory.create({
      channelId: 'ch-1',
      catalogId: 'SCAM',
      type: 'ban',
      label: 'Scam',
      normalizedLabel: 'scam',
      definition: 'Scam definition',
      enabled: true
    })

    const result = await runEvoModerationWorkflow(
      { channelId: 'ch-1', message: 'Hello world' },
      dependencies
    )

    expect(timeoutRender).not.toHaveBeenCalled()
    expect(timeoutDecide).not.toHaveBeenCalled()
    expect(result.workflow).toMatchObject({
      banSkipped: false,
      timeoutSkipped: true,
      timeoutAction: 'IGNORE',
      timeoutReason: 'No enabled timeout categories'
    })
    expect(result).toMatchObject({
      action: 'IGNORE',
      stage: 'timeout'
    })
  })

  it('returns IGNORE when no categories are enabled at all', async () => {
    const { dependencies, banRender, banDecide, timeoutRender, timeoutDecide } =
      createModerationDependencies()

    const result = await runEvoModerationWorkflow(
      { channelId: 'ch-1', message: 'Hello world' },
      dependencies
    )

    expect(banRender).not.toHaveBeenCalled()
    expect(banDecide).not.toHaveBeenCalled()
    expect(timeoutRender).not.toHaveBeenCalled()
    expect(timeoutDecide).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      action: 'IGNORE',
      catalogId: null,
      stage: 'timeout'
    })
    expect(result.workflow).toMatchObject({
      banSkipped: true,
      timeoutSkipped: true,
      banCategoriesCount: 0,
      timeoutCategoriesCount: 0
    })
  })

  it('passes only enabled categories grouped by type to each stage', async () => {
    const { dependencies, banDecide, timeoutDecide } =
      createModerationDependencies({
        banDecide: () => ({
          action: 'IGNORE' as const,
          categoryId: null,
          reason: 'No violation'
        }),
        timeoutDecide: () => ({
          action: 'IGNORE' as const,
          categoryId: null,
          reason: 'No violation'
        })
      })
    await ModerationCategory.create({
      channelId: 'ch-1',
      catalogId: 'SCAM',
      type: 'ban',
      label: 'Scam',
      normalizedLabel: 'scam',
      definition: 'Scam definition',
      enabled: true
    })
    await ModerationCategory.create({
      channelId: 'ch-1',
      catalogId: 'THREAT',
      type: 'ban',
      label: 'Threat',
      normalizedLabel: 'threat',
      definition: 'Threat definition',
      enabled: false
    })
    await ModerationCategory.create({
      channelId: 'ch-1',
      catalogId: 'INSULT',
      type: 'timeout',
      label: 'Insult',
      normalizedLabel: 'insult',
      definition: 'Insult definition',
      enabled: true
    })
    await ModerationCategory.create({
      channelId: 'ch-1',
      catalogId: 'TROLLING',
      type: 'timeout',
      label: 'Trolling',
      normalizedLabel: 'trolling',
      definition: 'Trolling definition',
      enabled: false
    })

    await runEvoModerationWorkflow(
      { channelId: 'ch-1', message: 'Hello' },
      dependencies
    )

    expect(banDecide).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedCategoryIds: ['SCAM']
      })
    )
    expect(timeoutDecide).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedCategoryIds: ['INSULT']
      })
    )
  })

  it('groups categories by per-channel type (ban vs timeout)', async () => {
    const { dependencies, banRender, timeoutRender } =
      createModerationDependencies({
        banDecide: () => ({
          action: 'IGNORE' as const,
          categoryId: null,
          reason: 'No violation'
        }),
        timeoutDecide: () => ({
          action: 'IGNORE' as const,
          categoryId: null,
          reason: 'No violation'
        })
      })
    await ModerationCategory.create({
      channelId: 'ch-1',
      catalogId: 'SCAM',
      type: 'ban',
      label: 'Scam',
      normalizedLabel: 'scam',
      definition: 'Scam definition',
      enabled: true
    })
    await ModerationCategory.create({
      channelId: 'ch-1',
      catalogId: 'INSULT',
      type: 'timeout',
      label: 'Insult',
      normalizedLabel: 'insult',
      definition: 'Insult definition',
      enabled: true
    })

    await runEvoModerationWorkflow(
      { channelId: 'ch-1', message: 'Hello' },
      dependencies
    )

    const banCall = banRender.mock.calls[0] as [
      EvoModerationBanPromptVariables
    ]
    expect(banCall[0].banCategories).toEqual([
      {
        category_id: 'SCAM',
        category_label: 'Scam',
        definition: 'Scam definition'
      }
    ])
    expect(banCall[0].banCategories).toHaveLength(1)

    const timeoutCall = timeoutRender.mock.calls[0] as [
      EvoModerationTimeoutPromptVariables
    ]
    expect(timeoutCall[0].timeoutCategories).toEqual([
      {
        category_id: 'INSULT',
        category_label: 'Insult',
        definition: 'Insult definition'
      }
    ])
    expect(timeoutCall[0].timeoutCategories).toHaveLength(1)
  })

  it('only loads categories for the specified channel', async () => {
    const { dependencies, banDecide } = createModerationDependencies({
      banDecide: () => ({
        action: 'IGNORE' as const,
        categoryId: null,
        reason: 'No violation'
      })
    })
    await ModerationCategory.create({
      channelId: 'ch-1',
      catalogId: 'SCAM',
      type: 'ban',
      label: 'Scam',
      normalizedLabel: 'scam',
      definition: 'Scam definition',
      enabled: true
    })
    await ModerationCategory.create({
      channelId: 'ch-2',
      catalogId: 'THREAT',
      type: 'ban',
      label: 'Threat',
      normalizedLabel: 'threat',
      definition: 'Threat definition',
      enabled: true
    })

    await runEvoModerationWorkflow(
      { channelId: 'ch-1', message: 'Hello' },
      dependencies
    )

    expect(banDecide).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedCategoryIds: ['SCAM']
      })
    )
  })

  it('returns the timeout decision when only timeout categories are enabled', async () => {
    const { dependencies } = createModerationDependencies({
      banDecide: (input) => ({
        action: 'IGNORE' as const,
        categoryId: null,
        reason: `Invalid`
      }),
      timeoutDecide: () => ({
        action: 'TIMEOUT' as const,
        categoryId: 'INSULT',
        reason: 'Insult detected'
      })
    })
    await ModerationCategory.create({
      channelId: 'ch-1',
      catalogId: 'INSULT',
      type: 'timeout',
      label: 'Insult',
      normalizedLabel: 'insult',
      definition: 'Direct insults',
      enabled: true
    })

    // This test relies on the OpenAI model's invalid-category handling,
    // which is tested in the OpenAIEvoModerationStageModel unit tests.
    // Here we test the workflow integration with mock that returns IGNORE.
    const result = await runEvoModerationWorkflow(
      { channelId: 'ch-1', message: 'Hello' },
      dependencies
    )

    expect(result.action).toBe('TIMEOUT')
    expect(result.catalogId).toBe('INSULT')
  })

  it('trims channelId before querying categories', async () => {
    const { dependencies, banDecide } = createModerationDependencies({
      banDecide: () => ({
        action: 'BAN' as const,
        categoryId: 'SCAM',
        reason: 'Phishing'
      })
    })
    await ModerationCategory.create({
      channelId: 'ch-1',
      catalogId: 'SCAM',
      type: 'ban',
      label: 'Scam',
      normalizedLabel: 'scam',
      definition: 'Scam definition',
      enabled: true
    })

    const result = await runEvoModerationWorkflow(
      { channelId: '  ch-1  ', message: 'Free giveaway' },
      dependencies
    )

    expect(result).toMatchObject({
      action: 'BAN',
      catalogId: 'SCAM'
    })
    expect(banDecide).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedCategoryIds: ['SCAM']
      })
    )
  })

  it('returns IGNORE with AGENT_DISABLED when moderationEnabled is false for the channel', async () => {
    await User.create({
      googleSubject: 'sub-1',
      email: 'test@example.com',
      name: 'Test User',
      picture: null,
      scope: [],
      channels: [
        {
          channelId: 'ch-1',
          name: 'Test Channel',
          handle: null,
          thumbnail: null,
          qnaEnabled: true,
          moderationEnabled: false
        }
      ],
      activeChannelId: 'ch-1',
      lastLoginAt: new Date()
    })

    await ModerationCategory.create({
      channelId: 'ch-1',
      catalogId: 'SCAM',
      type: 'ban',
      label: 'Scam',
      normalizedLabel: 'scam',
      definition: 'Scam definition',
      enabled: true
    })

    const { dependencies, banRender, banDecide, timeoutRender, timeoutDecide } =
      createModerationDependencies()

    const result = await runEvoModerationWorkflow(
      { channelId: 'ch-1', message: 'Free giveaway' },
      dependencies
    )

    expect(banRender).not.toHaveBeenCalled()
    expect(banDecide).not.toHaveBeenCalled()
    expect(timeoutRender).not.toHaveBeenCalled()
    expect(timeoutDecide).not.toHaveBeenCalled()

    expect(result).toMatchObject({
      agent: 'evo-moderation',
      action: 'IGNORE',
      catalogId: null,
      reason: 'AGENT_DISABLED',
      stage: 'timeout'
    })
    expect(result.workflow).toMatchObject({
      receivedMessage: true,
      normalized: false,
      normalizedMessage: 'Free giveaway',
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
    })
  })
})
