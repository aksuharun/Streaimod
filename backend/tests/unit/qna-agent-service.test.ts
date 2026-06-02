import { QnaEntry } from '../../src/models/qna-entry.js'
import { User } from '../../src/models/user.js'
import {
  OpenAIQnaAgentModel,
  parseQnaAgentDecision,
  RaisonQnaPromptRenderer,
  runQnaAgentWorkflow,
  type QnaAgentDependencies,
  type QnaAgentModelDecision,
  type QnaAgentModelInput,
  type QnaPromptVariables
} from '../../src/services/qna-agent-service.js'
import { withTemporaryEnv } from '../helpers/env.js'
import {
  clearTestDatabase,
  registerTestModel
} from '../helpers/test-database.js'

function createAgentDependencies(
  decide: (
    input: QnaAgentModelInput
  ) => QnaAgentModelDecision | Promise<QnaAgentModelDecision>
) {
  const render = vi.fn(async (_variables: QnaPromptVariables) => 'rendered qna prompt')
  const modelDecide = vi.fn(async (input: QnaAgentModelInput) => decide(input))
  const dependencies: QnaAgentDependencies = {
    promptRenderer: { render },
    model: { decide: modelDecide }
  }

  return { dependencies, render, modelDecide }
}

describe('parseQnaAgentDecision', () => {
  it('parses a valid Q&A agent JSON decision', () => {
    expect(
      parseQnaAgentDecision(
        JSON.stringify({
          question: 'what is the schedule',
          response: '3 PM EST daily'
        })
      )
    ).toEqual({
      question: 'what is the schedule',
      response: '3 PM EST daily'
    })
  })

  it('parses a fenced JSON decision', () => {
    expect(
      parseQnaAgentDecision(
        '```json\n{"question":"","response":""}\n```'
      )
    ).toEqual({
      question: '',
      response: ''
    })
  })

  it('rejects a missing question field', () => {
    expect(() =>
      parseQnaAgentDecision(
        JSON.stringify({
          response: '3 PM EST daily'
        })
      )
    ).toThrow(/invalid question/)
  })

  it('rejects a missing response field', () => {
    expect(() =>
      parseQnaAgentDecision(
        JSON.stringify({
          question: 'what is the schedule'
        })
      )
    ).toThrow(/invalid response/)
  })
})

describe('RaisonQnaPromptRenderer', () => {
  it('renders the Q&A prompt through Raison with the configured prompt ID', async () => {
    const render = vi.fn(async () => 'rendered qna prompt')
    const renderer = new RaisonQnaPromptRenderer({ render })
    const variables: QnaPromptVariables = {
      channelId: 'ch-1',
      messageText: 'Kaç yaşındasın',
      qnaEntries: [
        {
          id: 'entry-1',
          question: 'Kaç yaşındasın?',
          answer: '22 yaşındayım.'
        }
      ]
    }

    const result = await withTemporaryEnv(
      { RAISON_QNA_PROMPT_ID: 'prompt-1' },
      () => renderer.render(variables)
    )

    expect(result).toBe('rendered qna prompt')
    expect(render).toHaveBeenCalledWith('prompt-1', variables)
  })

  it('rejects an empty rendered Q&A prompt', async () => {
    const renderer = new RaisonQnaPromptRenderer({
      render: vi.fn(async () => '   ')
    })

    await expect(
      withTemporaryEnv({ RAISON_QNA_PROMPT_ID: 'prompt-1' }, () =>
        renderer.render({
          channelId: 'ch-1',
          messageText: 'Hello',
          qnaEntries: []
        })
      )
    ).rejects.toThrow(/empty Q&A agent prompt/)
  })
})

describe('OpenAIQnaAgentModel', () => {
  it('sends the rendered Raison prompt and Q&A entries to OpenAI and parses the decision', async () => {
    const requests: Array<{
      init: Parameters<typeof fetch>[1]
    }> = []
    const fetcher: typeof fetch = async (_input, init) => {
      requests.push({ init })
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  question: 'what is the schedule',
                  response: '3 PM EST daily'
                })
              }
            }
          ]
        }),
        { status: 200 }
      )
    }
    const model = new OpenAIQnaAgentModel(fetcher)

    const qnaEntries = [
      {
        id: 'entry-1',
        question: 'Kaç yaşındasın?',
        answer: '22 yaşındayım.'
      }
    ]

    const result = await withTemporaryEnv(
      {
        OPENAI_API_KEY: 'test-openai-key',
        OPENAI_MODEL: 'test-model'
      },
      () =>
        model.decide({
          systemPrompt: 'rendered qna prompt',
          messageText: 'Kaç yaşındasın',
          qnaEntries
        })
    )

    expect(result).toEqual({
      question: 'what is the schedule',
      response: '3 PM EST daily'
    })

    const body = JSON.parse(String(requests[0]?.init?.body)) as Record<string, unknown>
    expect(JSON.stringify(body)).toContain('rendered qna prompt')

    const messages = body.messages as Array<{ role: string; content: string }>
    expect(messages[0]).toEqual({ role: 'system', content: 'rendered qna prompt' })
    expect(messages[1].role).toBe('system')
    expect(messages[1].content).toContain('"entries"')
    expect(messages[1].content).toContain('Kaç yaşındasın?')
    expect(messages[2]).toEqual({ role: 'user', content: 'Kaç yaşındasın' })

    const format = body.response_format as Record<string, unknown>
    expect(format.type).toBe('json_schema')
    const schema = (format.json_schema as Record<string, unknown>)
    expect(schema.name).toBe('question_response')
    const schemaDef = schema.schema as Record<string, unknown>
    const properties = schemaDef.properties as Record<string, unknown>
    expect(properties).toHaveProperty('question')
    expect(properties).toHaveProperty('response')
  })

  it('throws when OpenAI rejects the Q&A agent request', async () => {
    const fetcher: typeof fetch = async () =>
      new Response('bad request', { status: 400 })
    const model = new OpenAIQnaAgentModel(fetcher)

    await expect(
      withTemporaryEnv({ OPENAI_API_KEY: 'test-openai-key' }, () =>
        model.decide({
          systemPrompt: 'rendered qna prompt',
          messageText: 'Hello',
          qnaEntries: []
        })
      )
    ).rejects.toThrow(/status 400/)
  })
})

describe('runQnaAgentWorkflow', () => {
  beforeAll(() => {
    registerTestModel(QnaEntry)
    registerTestModel(User)
  })

  beforeEach(async () => {
    await clearTestDatabase()
  })

  it('renders the Raison prompt and sends the stored answer selected by the Q&A agent', async () => {
    const entry = await QnaEntry.create({
      channelId: 'ch-1',
      question: 'What is the schedule?',
      normalizedQuestion: 'what is the schedule',
      answer: '3 PM EST daily',
      enabled: true
    })
    const { dependencies, render, modelDecide } = createAgentDependencies(() => ({
      question: 'what is the schedule',
      response: '3 PM EST daily'
    }))

    const result = await runQnaAgentWorkflow(
      {
        channelId: 'ch-1',
        messageText: 'WHAT is the schedule??!'
      },
      dependencies
    )

    expect(render).toHaveBeenCalledWith({
      channelId: 'ch-1',
      messageText: 'WHAT is the schedule??!',
      qnaEntries: [
        {
          id: String(entry._id),
          question: 'What is the schedule?',
          answer: '3 PM EST daily'
        }
      ]
    })
    expect(modelDecide).toHaveBeenCalledWith({
      systemPrompt: 'rendered qna prompt',
      messageText: 'WHAT is the schedule??!',
      qnaEntries: [
        {
          id: String(entry._id),
          question: 'What is the schedule?',
          answer: '3 PM EST daily'
        }
      ]
    })
    expect(result).toMatchObject({
      agent: 'qna',
      matched: true,
      action: 'SEND_ANSWER',
      answer: '3 PM EST daily',
      workflow: {
        receivedMessage: true,
        retrievedEntries: 1,
        retrievedQnaEntries: [
          {
            id: String(entry._id),
            question: 'What is the schedule?',
            answer: '3 PM EST daily'
          }
        ],
        normalizedMessage: 'what is the schedule',
        promptRendered: true,
        selectedEntryId: String(entry._id),
        decision: 'SEND_ANSWER',
        reason: 'ANSWER_FOUND'
      }
    })
    expect(result.entry?.question).toBe('What is the schedule?')
  })

  it('runs the Q&A agent for statement-like messages instead of pre-filtering with regex', async () => {
    await QnaEntry.create({
      channelId: 'ch-1',
      question: 'Schedule',
      normalizedQuestion: 'schedule',
      answer: '3 PM EST daily',
      enabled: true
    })
    const { dependencies, modelDecide } = createAgentDependencies(() => ({
      question: '',
      response: ''
    }))

    const result = await runQnaAgentWorkflow(
      {
        channelId: 'ch-1',
        messageText: 'schedule'
      },
      dependencies
    )

    expect(modelDecide).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      matched: false,
      action: 'DO_NOTHING',
      workflow: {
        retrievedEntries: 1,
        retrievedQnaEntries: [
          {
            question: 'Schedule',
            answer: '3 PM EST daily'
          }
        ],
        normalizedMessage: 'schedule',
        promptRendered: true,
        decision: 'DO_NOTHING',
        reason: 'NO_DATABASE_MATCH'
      }
    })
    expect(result).not.toHaveProperty('answer')
    expect(result).not.toHaveProperty('entry')
  })

  it('lets the Q&A agent answer non-English questions without English regex detection', async () => {
    await QnaEntry.create({
      channelId: 'ch-1',
      question: 'Kaç yaşındasın?',
      normalizedQuestion: 'kaç yaşındasın',
      answer: '22 yaşındayım.',
      enabled: true
    })
    const { dependencies } = createAgentDependencies(() => ({
      question: 'kaç yaşındasın',
      response: '22 yaşındayım.'
    }))

    const result = await runQnaAgentWorkflow(
      {
        channelId: 'ch-1',
        messageText: 'Kaç yaşındasın'
      },
      dependencies
    )

    expect(result).toMatchObject({
      matched: true,
      answer: '22 yaşındayım.',
      workflow: {
        decision: 'SEND_ANSWER',
        reason: 'ANSWER_FOUND'
      }
    })
  })

  it('matches Turkish stored questions when the model returns ASCII-only question text', async () => {
    await QnaEntry.create({
      channelId: 'ch-1',
      question: 'Yasin kaç?',
      normalizedQuestion: 'yasin kaç',
      answer: '22',
      enabled: true
    })
    const { dependencies } = createAgentDependencies(() => ({
      question: 'Yasin kac?',
      response: '22'
    }))

    const result = await runQnaAgentWorkflow(
      {
        channelId: 'ch-1',
        messageText: 'Yasin kac?'
      },
      dependencies
    )

    expect(result).toMatchObject({
      matched: true,
      action: 'SEND_ANSWER',
      answer: '22',
      workflow: {
        selectedEntryId: expect.any(String),
        decision: 'SEND_ANSWER',
        reason: 'ANSWER_FOUND'
      }
    })
  })

  it('falls back to a unique stored answer when the model question text is close but not exact', async () => {
    await QnaEntry.create({
      channelId: 'ch-1',
      question: 'Hangi programlama dillerini biliyorsun?',
      normalizedQuestion: 'hangi programlama dillerini biliyorsun',
      answer: 'JavaScript',
      enabled: true
    })
    const { dependencies } = createAgentDependencies(() => ({
      question: 'hangi programlama dilleri biliyorsun',
      response: 'JavaScript'
    }))

    const result = await runQnaAgentWorkflow(
      {
        channelId: 'ch-1',
        messageText: 'hangi programlama dilleri biliyorsun'
      },
      dependencies
    )

    expect(result).toMatchObject({
      matched: true,
      action: 'SEND_ANSWER',
      answer: 'JavaScript',
      workflow: {
        selectedEntryId: expect.any(String),
        decision: 'SEND_ANSWER',
        reason: 'ANSWER_FOUND'
      }
    })
  })

  it('does not fall back by answer when multiple entries share the same answer', async () => {
    await QnaEntry.create({
      channelId: 'ch-1',
      question: 'Question A?',
      normalizedQuestion: 'question a',
      answer: 'Same answer',
      enabled: true
    })
    await QnaEntry.create({
      channelId: 'ch-1',
      question: 'Question B?',
      normalizedQuestion: 'question b',
      answer: 'Same answer',
      enabled: true
    })
    const { dependencies } = createAgentDependencies(() => ({
      question: 'different question',
      response: 'Same answer'
    }))

    const result = await runQnaAgentWorkflow(
      {
        channelId: 'ch-1',
        messageText: 'different question'
      },
      dependencies
    )

    expect(result).toMatchObject({
      matched: false,
      action: 'DO_NOTHING',
      workflow: {
        decision: 'DO_NOTHING',
        reason: 'INVALID_AGENT_SELECTION'
      }
    })
  })

  it('does nothing when the agent finds no matching database answer', async () => {
    await QnaEntry.create({
      channelId: 'ch-1',
      question: 'What is the schedule?',
      normalizedQuestion: 'what is the schedule',
      answer: '3 PM EST daily',
      enabled: true
    })
    const { dependencies } = createAgentDependencies(() => ({
      question: '',
      response: ''
    }))

    const result = await runQnaAgentWorkflow(
      {
        channelId: 'ch-1',
        messageText: 'Who are you?'
      },
      dependencies
    )

    expect(result).toMatchObject({
      matched: false,
      action: 'DO_NOTHING',
      workflow: {
        retrievedEntries: 1,
        retrievedQnaEntries: [
          {
            question: 'What is the schedule?',
            answer: '3 PM EST daily'
          }
        ],
        normalizedMessage: 'who are you',
        decision: 'DO_NOTHING',
        reason: 'NO_DATABASE_MATCH'
      }
    })
  })

  it('does not send an answer when the agent selects an entry outside the retrieved database', async () => {
    await QnaEntry.create({
      channelId: 'ch-1',
      question: 'What is the schedule?',
      normalizedQuestion: 'what is the schedule',
      answer: '3 PM EST daily',
      enabled: true
    })
    const { dependencies } = createAgentDependencies(() => ({
      question: 'who are you',
      response: 'some generated answer not in db'
    }))

    const result = await runQnaAgentWorkflow(
      {
        channelId: 'ch-1',
        messageText: 'What is the schedule?'
      },
      dependencies
    )

    expect(result).toMatchObject({
      matched: false,
      action: 'DO_NOTHING',
      workflow: {
        retrievedEntries: 1,
        retrievedQnaEntries: [
          {
            question: 'What is the schedule?',
            answer: '3 PM EST daily'
          }
        ],
        decision: 'DO_NOTHING',
        reason: 'INVALID_AGENT_SELECTION'
      }
    })
  })

  it('does not expose disabled entries to the Q&A agent', async () => {
    await QnaEntry.create({
      channelId: 'ch-1',
      question: 'What is the schedule?',
      normalizedQuestion: 'what is the schedule',
      answer: '3 PM EST daily',
      enabled: false
    })
    const { dependencies, render } = createAgentDependencies(() => ({
      question: '',
      response: ''
    }))

    const result = await runQnaAgentWorkflow(
      {
        channelId: 'ch-1',
        messageText: 'What is the schedule?'
      },
      dependencies
    )

    expect(render).toHaveBeenCalledWith({
      channelId: 'ch-1',
      messageText: 'What is the schedule?',
      qnaEntries: []
    })
    expect(result).toMatchObject({
      matched: false,
      action: 'DO_NOTHING',
      workflow: {
        retrievedEntries: 0,
        retrievedQnaEntries: [],
        decision: 'DO_NOTHING',
        reason: 'NO_DATABASE_MATCH'
      }
    })
  })

  it('trims channelId before retrieving the Q&A database', async () => {
    await QnaEntry.create({
      channelId: 'ch-1',
      question: 'What is the schedule?',
      normalizedQuestion: 'what is the schedule',
      answer: '3 PM EST daily',
      enabled: true
    })
    const { dependencies } = createAgentDependencies(() => ({
      question: 'what is the schedule',
      response: '3 PM EST daily'
    }))

    const result = await runQnaAgentWorkflow(
      {
        channelId: '  ch-1  ',
        messageText: 'What is the schedule?'
      },
      dependencies
    )

    expect(result).toMatchObject({
      matched: true,
      answer: '3 PM EST daily',
      workflow: {
        retrievedEntries: 1,
        decision: 'SEND_ANSWER'
      }
    })
  })

  it('returns DO_NOTHING when qnaEnabled is false for the channel', async () => {
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
          qnaEnabled: false,
          moderationEnabled: true
        }
      ],
      activeChannelId: 'ch-1',
      lastLoginAt: new Date()
    })

    await QnaEntry.create({
      channelId: 'ch-1',
      question: 'What is the schedule?',
      normalizedQuestion: 'what is the schedule',
      answer: '3 PM EST daily',
      enabled: true
    })

    const { dependencies, render, modelDecide } = createAgentDependencies(() => ({
      question: 'what is the schedule',
      response: '3 PM EST daily'
    }))

    const result = await runQnaAgentWorkflow(
      {
        channelId: 'ch-1',
        messageText: 'What is the schedule?'
      },
      dependencies
    )

    expect(render).not.toHaveBeenCalled()
    expect(modelDecide).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      matched: false,
      action: 'DO_NOTHING',
      workflow: {
        receivedMessage: true,
        retrievedEntries: 0,
        retrievedQnaEntries: [],
        promptRendered: false,
        decision: 'DO_NOTHING',
        reason: 'AGENT_DISABLED'
      }
    })
    expect(result).not.toHaveProperty('answer')
    expect(result).not.toHaveProperty('entry')
  })
})
