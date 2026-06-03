import { ChatEvent } from '../../src/models/chat-event.js'
import {
  ingestChat,
  type ChatIngestionDependencies,
  type ChatIngestionInput
} from '../../src/services/chat-ingestion-service.js'
import type { ChatCommandMatchResult } from '../../src/services/chat-command-service.js'
import type { QnaAgentResult } from '../../src/services/qna-agent-service.js'
import type { EvoModerationResult } from '../../src/services/evo-moderation-service.js'
import { buildTestChatMessage } from '../helpers/factories.js'
import {
  clearTestDatabase,
  registerTestModel
} from '../helpers/test-database.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createValidInput(
  overrides: Partial<ChatIngestionInput> = {}
): ChatIngestionInput {
  const msg = buildTestChatMessage()
  return {
    channelId: overrides.channelId ?? msg.channelExternalId,
    messageId: overrides.messageId ?? 'msg-1',
    authorExternalId: overrides.authorExternalId ?? msg.authorExternalId,
    channelExternalId: overrides.channelExternalId ?? msg.channelExternalId,
    platform: overrides.platform ?? 'youtube',
    sentAt: overrides.sentAt ?? msg.sentAt,
    text: overrides.text ?? msg.text,
    skipQna: overrides.skipQna
  }
}

function createFakeQnaResult(
  overrides: Partial<QnaAgentResult> = {}
): QnaAgentResult {
  return {
    agent: 'qna',
    matched: false,
    action: 'DO_NOTHING',
    workflow: {
      receivedMessage: true,
      retrievedEntries: 0,
      normalizedMessage: 'how do i join the stream',
      promptRendered: true,
      decision: 'DO_NOTHING',
      reason: 'NOT_A_QUESTION'
    },
    ...overrides
  } as QnaAgentResult
}

function createFakeModerationResult(
  overrides: Partial<EvoModerationResult> = {}
): EvoModerationResult {
  return {
    agent: 'evo-moderation',
    action: 'IGNORE',
    catalogId: null,
    reason: null,
    stage: 'timeout',
    workflow: {
      receivedMessage: true,
      unicodeCount: 0,
      normalized: false,
      normalizedMessage: 'How do I join the stream?',
      banCategoriesCount: 0,
      timeoutCategoriesCount: 0,
      banSkipped: true,
      timeoutSkipped: true,
      banAction: 'IGNORE',
      banCatalogId: null,
      banReason: 'No enabled ban categories',
      timeoutAction: 'IGNORE',
      timeoutCatalogId: null,
      timeoutReason: 'No enabled timeout categories'
    },
    ...overrides
  } as EvoModerationResult
}

function createFakeDependencies(
  overrides: Partial<{
    matchChatCommand: ChatIngestionDependencies['matchChatCommand']
    runQnaAgentWorkflow: ChatIngestionDependencies['runQnaAgentWorkflow']
    runEvoModerationWorkflow: ChatIngestionDependencies['runEvoModerationWorkflow']
  }> = {}
): {
  dependencies: ChatIngestionDependencies
  matchChatCommand: ReturnType<typeof vi.fn>
  runQnaAgentWorkflow: ReturnType<typeof vi.fn>
  runEvoModerationWorkflow: ReturnType<typeof vi.fn>
} {
  const matchChatCommand = vi.fn(async (): Promise<ChatCommandMatchResult> => ({
    matched: false
  }))
  const runQnaAgentWorkflow = vi.fn(async () => createFakeQnaResult())
  const runEvoModerationWorkflow = vi.fn(async () =>
    createFakeModerationResult()
  )

  const dependencies: ChatIngestionDependencies = {
    matchChatCommand: overrides.matchChatCommand ?? matchChatCommand,
    runQnaAgentWorkflow: overrides.runQnaAgentWorkflow ?? runQnaAgentWorkflow,
    runEvoModerationWorkflow:
      overrides.runEvoModerationWorkflow ?? runEvoModerationWorkflow
  }

  return {
    dependencies,
    matchChatCommand,
    runQnaAgentWorkflow,
    runEvoModerationWorkflow
  }
}

// ─── Setup ───────────────────────────────────────────────────────────────────

describe('ingestChat', () => {
  beforeAll(() => {
    registerTestModel(ChatEvent)
  })

  beforeEach(async () => {
    await clearTestDatabase()
  })

  // ─── Successful ingest ───────────────────────────────────────────────────

  it('returns duplicate: false and persists the event for a new message', async () => {
    const { dependencies, runQnaAgentWorkflow, runEvoModerationWorkflow } =
      createFakeDependencies()
    const input = createValidInput()

    const result = await ingestChat(input, dependencies)

    expect(result.duplicate).toBe(false)
    expect(result.event).toBeDefined()
    expect(result.event!.platform).toBe('youtube')
    expect(result.event!.messageId).toBe('msg-1')
    expect(result.event!.text).toBe(input.text)

    const persisted = await ChatEvent.findOne({
      platform: 'youtube',
      messageId: 'msg-1'
    }).exec()

    expect(persisted).not.toBeNull()
    expect(persisted!.text).toBe(input.text)
  })

  it('runs Q&A and moderation workflows for a new message', async () => {
    const {
      dependencies,
      matchChatCommand,
      runQnaAgentWorkflow,
      runEvoModerationWorkflow
    } = createFakeDependencies()
    const input = createValidInput()

    await ingestChat(input, dependencies)

    expect(matchChatCommand).toHaveBeenCalledTimes(1)
    expect(matchChatCommand).toHaveBeenCalledWith({
      channelId: input.channelId,
      messageText: input.text
    })
    expect(runQnaAgentWorkflow).toHaveBeenCalledTimes(1)
    expect(runQnaAgentWorkflow).toHaveBeenCalledWith({
      channelId: input.channelId,
      messageText: input.text
    })
    expect(runEvoModerationWorkflow).toHaveBeenCalledTimes(1)
    expect(runEvoModerationWorkflow).toHaveBeenCalledWith({
      channelId: input.channelId,
      message: input.text
    })
  })

  it('returns both workflow results alongside the event', async () => {
    const commandResult: ChatCommandMatchResult = {
      matched: true,
      replyText: 'https://linktr.ee/mylink',
      command: {
        _id: 'command-1',
        channelId: 'channel-1',
        trigger: '!linktree',
        normalizedTrigger: '!linktree',
        replyText: 'https://linktr.ee/mylink',
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date()
      } as never
    }
    const qnaResult = createFakeQnaResult({
      matched: true,
      action: 'SEND_ANSWER'
    } as QnaAgentResult)
    const moderationResult = createFakeModerationResult({
      action: 'BAN',
      catalogId: 'SCAM'
    } as EvoModerationResult)
    const { dependencies } = createFakeDependencies({
      matchChatCommand: vi.fn(async () => commandResult),
      runQnaAgentWorkflow: vi.fn(async () => qnaResult),
      runEvoModerationWorkflow: vi.fn(async () => moderationResult)
    })

    const result = await ingestChat(createValidInput(), dependencies)

    expect(result.commandResult).toEqual(commandResult)
    expect(result.qnaResult).toBeDefined()
    expect(result.qnaResult!.action).toBe('SEND_ANSWER')
    expect(result.moderationResult).toBeDefined()
    expect(result.moderationResult!.action).toBe('BAN')
  })

  it('runs Q&A and moderation workflows in parallel (not sequentially)', async () => {
    const callOrder: string[] = []
    let resolveQna: ((value: QnaAgentResult) => void) | undefined
    let resolveModeration: ((value: EvoModerationResult) => void) | undefined

    const qnaPromise = new Promise<QnaAgentResult>((resolve) => {
      resolveQna = resolve
    })
    const moderationPromise = new Promise<EvoModerationResult>((resolve) => {
      resolveModeration = resolve
    })

    const { dependencies } = createFakeDependencies({
      runQnaAgentWorkflow: vi.fn(() => {
        callOrder.push('qna')
        return qnaPromise
      }),
      runEvoModerationWorkflow: vi.fn(() => {
        callOrder.push('moderation')
        return moderationPromise
      })
    })

    const ingestPromise = ingestChat(createValidInput(), dependencies)

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(callOrder).toEqual(['qna', 'moderation'])

    resolveQna?.(createFakeQnaResult())
    resolveModeration?.(createFakeModerationResult())

    await ingestPromise
  })

  // ─── Q&A skip ────────────────────────────────────────────────────────────

  it('skips Q&A workflow when skipQna is true and returns a HISTORY_SKIPPED result', async () => {
    const { dependencies, runQnaAgentWorkflow, runEvoModerationWorkflow } =
      createFakeDependencies()
    const input = createValidInput({ skipQna: true })

    const result = await ingestChat(input, dependencies)

    expect(runQnaAgentWorkflow).not.toHaveBeenCalled()
    expect(runEvoModerationWorkflow).toHaveBeenCalledTimes(1)
    expect(runEvoModerationWorkflow).toHaveBeenCalledWith({
      channelId: input.channelId,
      message: input.text
    })

    expect(result.duplicate).toBe(false)
    expect(result.qnaResult).toBeDefined()
    expect(result.qnaResult!.action).toBe('DO_NOTHING')
    expect(result.qnaResult!.matched).toBe(false)
    expect(result.qnaResult!.workflow.reason).toBe('HISTORY_SKIPPED')
    expect(result.qnaResult!.workflow.promptRendered).toBe(false)
    expect(result.qnaResult!.workflow.retrievedEntries).toBe(0)
    expect(result.moderationResult).toBeDefined()
  })

  it('runs Q&A workflow normally when skipQna is false', async () => {
    const { dependencies, runQnaAgentWorkflow, runEvoModerationWorkflow } =
      createFakeDependencies()
    const input = createValidInput({ skipQna: false })

    await ingestChat(input, dependencies)

    expect(runQnaAgentWorkflow).toHaveBeenCalledTimes(1)
    expect(runEvoModerationWorkflow).toHaveBeenCalledTimes(1)
  })

  it('runs Q&A workflow normally when skipQna is undefined', async () => {
    const { dependencies, runQnaAgentWorkflow, runEvoModerationWorkflow } =
      createFakeDependencies()
    const input = createValidInput()

    await ingestChat(input, dependencies)

    expect(runQnaAgentWorkflow).toHaveBeenCalledTimes(1)
    expect(runEvoModerationWorkflow).toHaveBeenCalledTimes(1)
  })

  it('skips Q&A and moderation for self-messages while still running commands', async () => {
    const {
      dependencies,
      matchChatCommand,
      runQnaAgentWorkflow,
      runEvoModerationWorkflow
    } = createFakeDependencies()
    const input = createValidInput({
      authorExternalId: 'channel-owner-1',
      channelExternalId: 'channel-owner-1'
    })

    const result = await ingestChat(input, dependencies)

    expect(matchChatCommand).toHaveBeenCalledTimes(1)
    expect(runQnaAgentWorkflow).not.toHaveBeenCalled()
    expect(runEvoModerationWorkflow).not.toHaveBeenCalled()
    expect(result.duplicate).toBe(false)
    expect(result.qnaResult).toMatchObject({
      agent: 'qna',
      action: 'DO_NOTHING',
      matched: false,
      workflow: {
        reason: 'SELF_MESSAGE_SKIPPED'
      }
    })
    expect(result.moderationResult).toMatchObject({
      agent: 'evo-moderation',
      action: 'IGNORE',
      reason: 'SELF_MESSAGE_SKIPPED',
      stage: 'timeout',
      workflow: {
        banSkipped: true,
        timeoutSkipped: true,
        timeoutReason: 'SELF_MESSAGE_SKIPPED'
      }
    })
  })

  // ─── Duplicate handling ──────────────────────────────────────────────────

  it('returns duplicate: true when an event with the same platform + messageId already exists', async () => {
    const existing = await ChatEvent.create({
      channelId: 'ch-dup',
      messageId: 'msg-1',
      authorExternalId: 'author-1',
      channelExternalId: 'ch-ext-1',
      platform: 'youtube',
      sentAt: new Date(),
      text: 'original text'
    })

    const { dependencies, runQnaAgentWorkflow, runEvoModerationWorkflow } =
      createFakeDependencies()

    const result = await ingestChat(
      createValidInput({
        messageId: 'msg-1',
        platform: 'youtube'
      }),
      dependencies
    )

    expect(result.duplicate).toBe(true)
    expect(result.event).toBeDefined()
    expect(String(result.event!._id)).toBe(String(existing._id))
  })

  it('does not run workflows when the event is a duplicate', async () => {
    await ChatEvent.create({
      channelId: 'ch-dup',
      messageId: 'msg-1',
      authorExternalId: 'author-1',
      channelExternalId: 'ch-ext-1',
      platform: 'youtube',
      sentAt: new Date(),
      text: 'original text'
    })

    const {
      dependencies,
      matchChatCommand,
      runQnaAgentWorkflow,
      runEvoModerationWorkflow
    } = createFakeDependencies()

    await ingestChat(
      createValidInput({
        messageId: 'msg-1',
        platform: 'youtube'
      }),
      dependencies
    )

    expect(matchChatCommand).not.toHaveBeenCalled()
    expect(runQnaAgentWorkflow).not.toHaveBeenCalled()
    expect(runEvoModerationWorkflow).not.toHaveBeenCalled()
  })

  it('does not treat different platforms as duplicates', async () => {
    await ChatEvent.create({
      channelId: 'ch-1',
      messageId: 'msg-1',
      authorExternalId: 'author-1',
      channelExternalId: 'ch-ext-1',
      platform: 'youtube',
      sentAt: new Date(),
      text: 'youtube msg'
    })

    const { dependencies, runQnaAgentWorkflow, runEvoModerationWorkflow } =
      createFakeDependencies()

    const result = await ingestChat(
      createValidInput({
        messageId: 'msg-1',
        platform: 'twitch'
      }),
      dependencies
    )

    expect(result.duplicate).toBe(false)
    expect(runQnaAgentWorkflow).toHaveBeenCalledTimes(1)
    expect(runEvoModerationWorkflow).toHaveBeenCalledTimes(1)
  })

  it('does not treat different messageIds on the same platform as duplicates', async () => {
    await ChatEvent.create({
      channelId: 'ch-1',
      messageId: 'msg-1',
      authorExternalId: 'author-1',
      channelExternalId: 'ch-ext-1',
      platform: 'youtube',
      sentAt: new Date(),
      text: 'first msg'
    })

    const { dependencies, runQnaAgentWorkflow, runEvoModerationWorkflow } =
      createFakeDependencies()

    const result = await ingestChat(
      createValidInput({
        messageId: 'msg-2',
        platform: 'youtube'
      }),
      dependencies
    )

    expect(result.duplicate).toBe(false)
    expect(runQnaAgentWorkflow).toHaveBeenCalledTimes(1)
  })

  it('allows ingesting the same message on multiple platforms without treating it as duplicate', async () => {
    const { dependencies } = createFakeDependencies()

    const resultYt = await ingestChat(
      createValidInput({
        messageId: 'shared-msg',
        platform: 'youtube'
      }),
      dependencies
    )

    const resultTw = await ingestChat(
      createValidInput({
        messageId: 'shared-msg',
        platform: 'twitch'
      }),
      dependencies
    )

    expect(resultYt.duplicate).toBe(false)
    expect(resultTw.duplicate).toBe(false)

    const count = await ChatEvent.countDocuments({ messageId: 'shared-msg' })
    expect(count).toBe(2)
  })

  // ─── Duplicate-key race condition ────────────────────────────────────────

  it('does not run workflows when event creation loses a duplicate-key race', async () => {
    const { dependencies, runQnaAgentWorkflow, runEvoModerationWorkflow } =
      createFakeDependencies()

    const existing = await ChatEvent.create({
      channelId: 'existing-channel',
      messageId: 'race-msg',
      authorExternalId: 'existing-author',
      channelExternalId: 'existing-external-channel',
      platform: 'youtube',
      sentAt: new Date('2025-01-01T00:00:00.000Z'),
      text: 'existing text'
    })

    const duplicateKeyError = Object.assign(
      new Error('E11000 duplicate key error collection'),
      { code: 11000 }
    )

    vi.spyOn(ChatEvent, 'create').mockRejectedValueOnce(duplicateKeyError)

    const result = await ingestChat(
      createValidInput({
        messageId: 'race-msg',
        platform: 'youtube'
      }),
      dependencies
    )

    expect(result.duplicate).toBe(true)
    expect(String(result.event._id)).toBe(String(existing._id))
    expect(runQnaAgentWorkflow).not.toHaveBeenCalled()
    expect(runEvoModerationWorkflow).not.toHaveBeenCalled()

    await expect(
      ChatEvent.countDocuments({ platform: 'youtube', messageId: 'race-msg' })
    ).resolves.toBe(1)
  })

  it('rolls back the reserved event when a workflow fails after creation', async () => {
    const workflowError = new Error('Q&A workflow failed')
    const { dependencies, runEvoModerationWorkflow } = createFakeDependencies({
      runQnaAgentWorkflow: vi.fn(async () => {
        throw workflowError
      })
    })

    await expect(
      ingestChat(
        createValidInput({
          messageId: 'rollback-msg',
          platform: 'youtube'
        }),
        dependencies
      )
    ).rejects.toThrow('Q&A workflow failed')

    expect(runEvoModerationWorkflow).toHaveBeenCalledTimes(1)
    await expect(
      ChatEvent.countDocuments({ platform: 'youtube', messageId: 'rollback-msg' })
    ).resolves.toBe(0)
  })

  // ─── channelId trimming ──────────────────────────────────────────────────

  it('trims channelId before checking duplicates and persisting', async () => {
    const { dependencies } = createFakeDependencies()
    const input = createValidInput({
      channelId: '  ch-trim  ',
      messageId: 'msg-trim',
      platform: 'youtube'
    })

    const result = await ingestChat(input, dependencies)

    expect(result.duplicate).toBe(false)
    expect(result.event).toBeDefined()
    expect(result.event!.channelId).toBe('ch-trim')

    // Verify a duplicate check with trimmed channelId would find it
    const duplicateCheck = await ingestChat(
      createValidInput({
        channelId: 'ch-trim',
        messageId: 'msg-trim',
        platform: 'youtube'
      }),
      dependencies
    )

    expect(duplicateCheck.duplicate).toBe(true)
  })

  // ─── Validation: invalid platform ────────────────────────────────────────

  it.each([
    { label: 'empty string (before trim)', value: '  ' },
    { label: 'empty string', value: '' },
    { label: 'random string', value: 'discord' },
    { label: 'uppercase variant', value: 'YOUTUBE' },
    { label: 'title-case variant', value: 'YouTube' }
  ])(
    'rejects invalid platform "$label" at the service boundary',
    async ({ value }) => {
      const { dependencies, runQnaAgentWorkflow, runEvoModerationWorkflow } =
        createFakeDependencies()

      await expect(
        ingestChat(
          createValidInput({ platform: value as ChatIngestionInput['platform'] }),
          dependencies
        )
      ).rejects.toThrow(/platform/i)

      expect(runQnaAgentWorkflow).not.toHaveBeenCalled()
      expect(runEvoModerationWorkflow).not.toHaveBeenCalled()
    }
  )

  // ─── Validation: missing / empty strings ─────────────────────────────────

  it.each([
    { field: 'channelId', label: 'empty channelId' },
    { field: 'channelId', label: 'whitespace channelId' },
    { field: 'messageId', label: 'empty messageId' },
    { field: 'messageId', label: 'whitespace messageId' },
    { field: 'authorExternalId', label: 'empty authorExternalId' },
    { field: 'authorExternalId', label: 'whitespace authorExternalId' },
    { field: 'channelExternalId', label: 'empty channelExternalId' },
    { field: 'channelExternalId', label: 'whitespace channelExternalId' },
    { field: 'sentAt', label: 'empty sentAt' },
    { field: 'sentAt', label: 'whitespace sentAt' },
    { field: 'text', label: 'empty text' },
    { field: 'text', label: 'whitespace text' }
  ])(
    'rejects $label at the service boundary',
    async ({ field, label }) => {
      const { dependencies, runQnaAgentWorkflow, runEvoModerationWorkflow } =
        createFakeDependencies()

      const value = label.startsWith('whitespace') ? '   ' : ''

      await expect(
        ingestChat(
          createValidInput({
            [field]: value
          } as Partial<ChatIngestionInput>),
          dependencies
        )
      ).rejects.toThrow(/must be a non-empty string/i)

      expect(runQnaAgentWorkflow).not.toHaveBeenCalled()
      expect(runEvoModerationWorkflow).not.toHaveBeenCalled()
    }
  )

  it('rejects an invalid sentAt date string at the service boundary', async () => {
    const { dependencies, runQnaAgentWorkflow, runEvoModerationWorkflow } =
      createFakeDependencies()

    await expect(
      ingestChat(createValidInput({ sentAt: 'not-a-date' }), dependencies)
    ).rejects.toThrow(/valid date string/i)

    expect(runQnaAgentWorkflow).not.toHaveBeenCalled()
    expect(runEvoModerationWorkflow).not.toHaveBeenCalled()
  })

  // ─── Edge cases ──────────────────────────────────────────────────────────

  it('persists the full event payload including authorExternalId and channelExternalId', async () => {
    const { dependencies } = createFakeDependencies()
    const input = createValidInput({
      authorExternalId: 'author-ext-42',
      channelExternalId: 'channel-ext-99',
      text: 'stream question'
    })

    const result = await ingestChat(input, dependencies)

    expect(result.event!.authorExternalId).toBe('author-ext-42')
    expect(result.event!.channelExternalId).toBe('channel-ext-99')
    expect(result.event!.text).toBe('stream question')
  })

  it('parses sentAt as a Date', async () => {
    const { dependencies } = createFakeDependencies()
    const isoString = '2025-01-15T14:30:00.000Z'

    const result = await ingestChat(
      createValidInput({ sentAt: isoString }),
      dependencies
    )

    expect(result.event!.sentAt).toBeInstanceOf(Date)
    expect(result.event!.sentAt.toISOString()).toBe(isoString)
  })

  it('supports all three valid platforms', async () => {
    const { dependencies } = createFakeDependencies()

    for (const platform of ['youtube', 'twitch', 'kick'] as const) {
      const result = await ingestChat(
        createValidInput({
          platform,
          messageId: `multi-platform-${platform}`
        }),
        dependencies
      )

      expect(result.duplicate).toBe(false)
      expect(result.event!.platform).toBe(platform)
    }
  })
})
