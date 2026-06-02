import {
  createYoutubeProducerRuntime,
  type YoutubeProducerLogger
} from '../../src/runtime/youtube-producer.js'
import { PlatformApiError } from 'unified-creator-metrics'
import { ChatAction } from '../../src/models/chat-action.js'
import {
  clearTestDatabase,
  registerTestModel
} from '../helpers/test-database.js'

type MockYoutubeListener = {
  handlers: {
    message: Array<(message: any) => void | Promise<void>>
    error: Array<(error: unknown) => void | Promise<void>>
  }
  on: ReturnType<typeof vi.fn>
  off: ReturnType<typeof vi.fn>
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
}

function createMockYoutubeListener(): MockYoutubeListener {
  const handlers = {
    message: [] as Array<(message: any) => void | Promise<void>>,
    error: [] as Array<(error: unknown) => void | Promise<void>>
  }

  const listener: MockYoutubeListener = {
    handlers,
    on: vi.fn((event, handler) => {
      if (event === 'message') {
        handlers.message.push(handler)
      } else if (event === 'error') {
        handlers.error.push(handler)
      }

      return listener
    }),
    off: vi.fn(() => listener),
    start: vi.fn(async () => ({
      liveChatId: 'live-chat-1',
      liveVideoId: 'video-1'
    })),
    stop: vi.fn(async () => undefined)
  }

  return listener
}

function createLogger(): {
  logger: YoutubeProducerLogger
  info: ReturnType<typeof vi.fn>
  warn: ReturnType<typeof vi.fn>
  error: ReturnType<typeof vi.fn>
} {
  const info = vi.fn()
  const warn = vi.fn()
  const error = vi.fn()

  return {
    logger: { info, warn, error },
    info,
    warn,
    error
  }
}

function createMockYoutubeClient(listener: MockYoutubeListener) {
  return {
    platform: 'youtube' as const,
    channels: { resolve: vi.fn(), getMetrics: vi.fn(), getAuthenticatedUser: vi.fn() },
    videos: { getMetrics: vi.fn() },
    polls: { create: vi.fn(), end: vi.fn() },
    chat: {
      listen: vi.fn(() => listener),
      sendMessage: vi.fn(),
      deleteMessage: vi.fn(),
      banUser: vi.fn(),
      timeoutUser: vi.fn(),
      unbanUser: vi.fn()
    },
    livestreams: {
      getActive: vi.fn(),
      getScheduled: vi.fn(),
      getAuthenticatedChannelActive: vi.fn(),
      getAuthenticatedChannelScheduled: vi.fn()
    }
  }
}

function createYoutubeMessage(overrides: Record<string, unknown> = {}) {
  return {
    platform: 'youtube',
    type: 'message',
    id: 'msg-1',
    text: 'Hello world',
    sentAt: '2026-05-30T10:00:00.000Z',
    author: {
      id: 'author-1',
      username: 'author-username',
      displayName: 'Author'
    },
    channel: {
      id: 'channel-external-1',
      slug: 'channel-slug',
      displayName: 'Channel'
    },
    ...overrides
  }
}

function createIngestResponse(overrides: Record<string, unknown> = {}) {
  return {
    duplicate: false,
    event: {
      channelId: 'channel-1',
      messageId: 'msg-1',
      authorExternalId: 'author-1',
      platform: 'youtube'
    },
    command: {
      matched: false
    },
    qna: null,
    moderation: {
      action: 'IGNORE',
      catalogId: null,
      reason: 'No violation'
    },
    ...overrides
  }
}

function createYoutubeAuthError(
  status = 401,
  reason: string = 'authError',
  message: string = 'Request had invalid authentication credentials.'
) {
  return new PlatformApiError('YouTube API request failed.', {
    platform: 'youtube',
    status,
    cause: {
      response: {
        status,
        data: {
          error: {
            message,
            errors: [{ reason }]
          }
        }
      }
    }
  })
}

beforeAll(() => {
  registerTestModel(ChatAction)
})

beforeEach(async () => {
  await clearTestDatabase()
})

describe('createYoutubeProducerRuntime', () => {
  it('starts the listener and posts normalized messages to chat ingest', async () => {
    const listener = createMockYoutubeListener()
    const youtube = createMockYoutubeClient(listener)
    const createYoutubeClient = vi.fn(() => youtube)
    const fetch = vi.fn(async () => new Response(null, { status: 201 }))
    const { logger, info } = createLogger()

    const runtime = createYoutubeProducerRuntime(
      {
        channelId: 'channel-1',
        liveVideoId: 'video-1',
        ingestUrl: 'http://127.0.0.1:3000/api/chat/ingest',
        accessToken: 'youtube-access-token'
      },
      {
        createYoutubeClient,
        fetch,
        logger
      }
    )

    await runtime.start()

    await listener.handlers.message[0]?.(createYoutubeMessage())

    expect(createYoutubeClient).toHaveBeenCalledWith({
      accessToken: 'youtube-access-token'
    })
    expect(youtube.chat.listen).toHaveBeenCalledWith({
      liveVideoId: 'video-1',
      pollingIntervalMs: undefined,
      maxResults: undefined,
      includeHistory: true
    })
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/api/chat/ingest',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        }
      })
    )
    const [, requestInit] = fetch.mock.calls[0] as unknown as [
      string,
      RequestInit
    ]

    const parsedBody = JSON.parse(requestInit.body as string)
    expect(parsedBody).toEqual({
      channelId: 'channel-1',
      messageId: 'msg-1',
      authorExternalId: 'author-1',
      channelExternalId: 'channel-external-1',
      platform: 'youtube',
      sentAt: '2026-05-30T10:00:00.000Z',
      text: 'Hello world'
    })
    expect(parsedBody).not.toHaveProperty('skipQna')
    expect(info).toHaveBeenCalledWith(
      'YouTube producer started',
      expect.objectContaining({
        channelId: 'channel-1',
        liveVideoId: 'video-1',
        liveChatId: 'live-chat-1'
      })
    )
    expect(info).toHaveBeenCalledWith(
      'YouTube chat message received',
      expect.objectContaining({
        messageId: 'msg-1',
        viewerMessage: 'Hello world',
        messageSource: 'realtime'
      })
    )
  })

  it('treats 200 responses from chat ingest as success', async () => {
    const listener = createMockYoutubeListener()
    const fetch = vi.fn(async () => new Response(null, { status: 200 }))

    const runtime = createYoutubeProducerRuntime(
      {
        channelId: 'channel-1',
        liveVideoId: 'video-1',
        ingestUrl: 'http://127.0.0.1:3000/api/chat/ingest',
        accessToken: 'youtube-access-token'
      },
      {
        createYoutubeClient: vi.fn(() => createMockYoutubeClient(listener)),
        fetch,
        logger: createLogger().logger
      }
    )

    await runtime.start()

    await expect(
      listener.handlers.message[0]?.(
        createYoutubeMessage({
          author: { id: 'author-1', username: null, displayName: null },
          channel: { id: 'channel-external-1', slug: null, displayName: null }
        })
      )
    ).resolves.toBeUndefined()
  })

  it('skips and logs messages with missing author or channel IDs', async () => {
    const listener = createMockYoutubeListener()
    const fetch = vi.fn(async () => new Response(null, { status: 201 }))
    const { logger, warn } = createLogger()

    const runtime = createYoutubeProducerRuntime(
      {
        channelId: 'channel-1',
        liveVideoId: 'video-1',
        ingestUrl: 'http://127.0.0.1:3000/api/chat/ingest',
        accessToken: 'youtube-access-token'
      },
      {
        createYoutubeClient: vi.fn(() => createMockYoutubeClient(listener)),
        fetch,
        logger
      }
    )

    await runtime.start()

    await listener.handlers.message[0]?.({
      platform: 'youtube',
      type: 'message',
      id: 'msg-1',
      text: 'Hello world',
      sentAt: '2026-05-30T10:00:00.000Z',
      author: { id: null, username: null, displayName: null },
      channel: { id: 'channel-external-1', slug: null, displayName: null }
    })

    await listener.handlers.message[0]?.({
      platform: 'youtube',
      type: 'message',
      id: 'msg-2',
      text: 'Hello again',
      sentAt: '2026-05-30T10:00:01.000Z',
      author: { id: 'author-1', username: null, displayName: null },
      channel: { id: null, slug: null, displayName: null }
    })

    expect(fetch).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenNthCalledWith(
      1,
      'Skipping YouTube chat message because author.id is missing',
      expect.objectContaining({ messageId: 'msg-1' })
    )
    expect(warn).toHaveBeenNthCalledWith(
      2,
      'Skipping YouTube chat message because channel.id is missing',
      expect.objectContaining({ messageId: 'msg-2' })
    )
  })

  it('stops the active listener during shutdown', async () => {
    const listener = createMockYoutubeListener()
    const { logger, info } = createLogger()

    const runtime = createYoutubeProducerRuntime(
      {
        channelId: 'channel-1',
        liveVideoId: 'video-1',
        ingestUrl: 'http://127.0.0.1:3000/api/chat/ingest',
        accessToken: 'youtube-access-token'
      },
      {
        createYoutubeClient: vi.fn(() => createMockYoutubeClient(listener)),
        fetch: vi.fn(async () => new Response(null, { status: 201 })),
        logger
      }
    )

    await runtime.start()
    await runtime.stop()

    expect(listener.stop).toHaveBeenCalledTimes(1)
    expect(info).toHaveBeenCalledWith(
      'YouTube producer stopped',
      expect.objectContaining({
        channelId: 'channel-1',
        liveVideoId: 'video-1'
      })
    )
  })

  it('throws on start when no OAuth token or token resolver is available', async () => {
    const listener = createMockYoutubeListener()

    const runtime = createYoutubeProducerRuntime(
      {
        channelId: 'channel-1',
        liveVideoId: 'video-1',
        ingestUrl: 'http://127.0.0.1:3000/api/chat/ingest'
      },
      {
        createYoutubeClient: vi.fn(() => createMockYoutubeClient(listener)),
        fetch: vi.fn(async () => new Response(null, { status: 201 })),
        logger: createLogger().logger
      }
    )

    await expect(runtime.start()).rejects.toThrow(/access token is required/)
  })

  it('sends a Q&A answer returned by chat ingest and records the action', async () => {
    const listener = createMockYoutubeListener()
    const youtube = createMockYoutubeClient(listener)
    const fetch = vi.fn(async () =>
      new Response(
        JSON.stringify(
          createIngestResponse({
            qna: {
              matched: true,
              action: 'SEND_ANSWER',
              answer: 'The replay starts at 8 PM.',
              entry: { id: 'qna-1' }
            }
          })
        ),
        { status: 201 }
      )
    )

    const runtime = createYoutubeProducerRuntime(
      {
        channelId: 'channel-1',
        liveVideoId: 'video-1',
        ingestUrl: 'http://127.0.0.1:3000/api/chat/ingest',
        accessToken: 'youtube-access-token'
      },
      {
        createYoutubeClient: vi.fn(() => youtube),
        fetch,
        logger: createLogger().logger
      }
    )

    await runtime.start()
    await listener.handlers.message[0]?.(createYoutubeMessage())

    expect(youtube.chat.sendMessage).toHaveBeenCalledWith({
      liveChatId: 'live-chat-1',
      text: '@author-username The replay starts at 8 PM.'
    })

    const action = await ChatAction.findOne({
      platform: 'youtube',
      messageId: 'msg-1',
      type: 'qna_reply'
    }).lean().exec()

    expect(action).toEqual(
      expect.objectContaining({
        channelId: 'channel-1',
        liveChatId: 'live-chat-1',
        authorExternalId: 'author-1',
        qnaEntryId: 'qna-1',
        status: 'succeeded'
      })
    )
  })

  it('sends a command reply returned by chat ingest and records the action', async () => {
    const listener = createMockYoutubeListener()
    const youtube = createMockYoutubeClient(listener)
    const fetch = vi.fn(async () =>
      new Response(
        JSON.stringify(
          createIngestResponse({
            command: {
              matched: true,
              replyText: 'You can reach me at https://linktr.ee/mylink',
              command: { id: 'command-1', trigger: '!linktree' }
            }
          })
        ),
        { status: 201 }
      )
    )

    const runtime = createYoutubeProducerRuntime(
      {
        channelId: 'channel-1',
        liveVideoId: 'video-1',
        ingestUrl: 'http://127.0.0.1:3000/api/chat/ingest',
        accessToken: 'youtube-access-token'
      },
      {
        createYoutubeClient: vi.fn(() => youtube),
        fetch,
        logger: createLogger().logger
      }
    )

    await runtime.start()
    await listener.handlers.message[0]?.(createYoutubeMessage())

    expect(youtube.chat.sendMessage).toHaveBeenCalledWith({
      liveChatId: 'live-chat-1',
      text: 'You can reach me at https://linktr.ee/mylink'
    })

    const action = await ChatAction.findOne({
      platform: 'youtube',
      messageId: 'msg-1',
      type: 'command_reply'
    }).lean().exec()

    expect(action).toEqual(
      expect.objectContaining({
        channelId: 'channel-1',
        liveChatId: 'live-chat-1',
        authorExternalId: 'author-1',
        reason: '!linktree',
        status: 'succeeded'
      })
    )
  })

  it('prioritizes command replies over Q&A replies for explicit command matches', async () => {
    const listener = createMockYoutubeListener()
    const youtube = createMockYoutubeClient(listener)
    const fetch = vi.fn(async () =>
      new Response(
        JSON.stringify(
          createIngestResponse({
            command: {
              matched: true,
              replyText: 'Command reply',
              command: { id: 'command-1', trigger: '!linktree' }
            },
            qna: {
              matched: true,
              action: 'SEND_ANSWER',
              answer: 'Q&A reply',
              entry: { id: 'qna-1' }
            }
          })
        ),
        { status: 201 }
      )
    )

    const runtime = createYoutubeProducerRuntime(
      {
        channelId: 'channel-1',
        liveVideoId: 'video-1',
        ingestUrl: 'http://127.0.0.1:3000/api/chat/ingest',
        accessToken: 'youtube-access-token'
      },
      {
        createYoutubeClient: vi.fn(() => youtube),
        fetch,
        logger: createLogger().logger
      }
    )

    await runtime.start()
    await listener.handlers.message[0]?.(createYoutubeMessage())

    expect(youtube.chat.sendMessage).toHaveBeenCalledTimes(1)
    expect(youtube.chat.sendMessage).toHaveBeenCalledWith({
      liveChatId: 'live-chat-1',
      text: 'Command reply'
    })

    await expect(
      ChatAction.findOne({
        platform: 'youtube',
        messageId: 'msg-1',
        type: 'command_reply'
      }).lean().exec()
    ).resolves.not.toBeNull()

    await expect(
      ChatAction.findOne({
        platform: 'youtube',
        messageId: 'msg-1',
        type: 'qna_reply'
      }).lean().exec()
    ).resolves.toBeNull()
  })

  it('applies a ban before Q&A replies and records the moderation action', async () => {
    const listener = createMockYoutubeListener()
    const youtube = createMockYoutubeClient(listener)
    const fetch = vi.fn(async () =>
      new Response(
        JSON.stringify(
          createIngestResponse({
            qna: {
              matched: true,
              action: 'SEND_ANSWER',
              answer: 'Do not send this.',
              entry: { id: 'qna-1' }
            },
            moderation: {
              action: 'BAN',
              catalogId: 'SCAM',
              reason: 'Phishing link'
            }
          })
        ),
        { status: 201 }
      )
    )

    const runtime = createYoutubeProducerRuntime(
      {
        channelId: 'channel-1',
        liveVideoId: 'video-1',
        ingestUrl: 'http://127.0.0.1:3000/api/chat/ingest',
        accessToken: 'youtube-access-token'
      },
      {
        createYoutubeClient: vi.fn(() => youtube),
        fetch,
        logger: createLogger().logger
      }
    )

    await runtime.start()
    await listener.handlers.message[0]?.(createYoutubeMessage())

    expect(youtube.chat.banUser).toHaveBeenCalledWith({
      liveChatId: 'live-chat-1',
      userId: 'author-1'
    })
    expect(youtube.chat.sendMessage).not.toHaveBeenCalled()

    const action = await ChatAction.findOne({
      platform: 'youtube',
      messageId: 'msg-1',
      type: 'ban'
    }).lean().exec()

    expect(action).toEqual(
      expect.objectContaining({
        catalogId: 'SCAM',
        reason: 'Phishing link',
        status: 'succeeded'
      })
    )
  })

  it('applies timeout decisions with the configured duration', async () => {
    const listener = createMockYoutubeListener()
    const youtube = createMockYoutubeClient(listener)
    const fetch = vi.fn(async () =>
      new Response(
        JSON.stringify(
          createIngestResponse({
            moderation: {
              action: 'TIMEOUT',
              catalogId: 'SPAM',
              reason: 'Repeated spam'
            }
          })
        ),
        { status: 201 }
      )
    )

    const runtime = createYoutubeProducerRuntime(
      {
        channelId: 'channel-1',
        liveVideoId: 'video-1',
        ingestUrl: 'http://127.0.0.1:3000/api/chat/ingest',
        accessToken: 'youtube-access-token',
        timeoutDurationSeconds: 120
      },
      {
        createYoutubeClient: vi.fn(() => youtube),
        fetch,
        logger: createLogger().logger
      }
    )

    await runtime.start()
    await listener.handlers.message[0]?.(createYoutubeMessage())

    expect(youtube.chat.timeoutUser).toHaveBeenCalledWith({
      liveChatId: 'live-chat-1',
      userId: 'author-1',
      durationSeconds: 120
    })
  })

  it('includes the viewer message in the resolved action log', async () => {
    const listener = createMockYoutubeListener()
    const youtube = createMockYoutubeClient(listener)
    const fetch = vi.fn(async () =>
      new Response(
        JSON.stringify(
          createIngestResponse({
            moderation: {
              action: 'IGNORE',
              catalogId: null,
              reason: 'No violation'
            }
          })
        ),
        { status: 201 }
      )
    )
    const { logger, info } = createLogger()

    const runtime = createYoutubeProducerRuntime(
      {
        channelId: 'channel-1',
        liveVideoId: 'video-1',
        ingestUrl: 'http://127.0.0.1:3000/api/chat/ingest',
        accessToken: 'youtube-access-token'
      },
      {
        createYoutubeClient: vi.fn(() => youtube),
        fetch,
        logger
      }
    )

    await runtime.start()
    await listener.handlers.message[0]?.(
      createYoutubeMessage({ text: 'valla mi bu mesaj gorunsun' })
    )

    expect(info).toHaveBeenCalledWith(
      'YouTube chat action resolved',
      expect.objectContaining({
        messageId: 'msg-1',
        viewerMessage: 'valla mi bu mesaj gorunsun',
        selectedAction: 'NONE',
        moderationAction: 'IGNORE',
        qnaAction: null
      })
    )
  })

  it('does not execute actions for duplicate ingest responses', async () => {
    const listener = createMockYoutubeListener()
    const youtube = createMockYoutubeClient(listener)
    const fetch = vi.fn(async () =>
      new Response(
        JSON.stringify(createIngestResponse({ duplicate: true })),
        { status: 200 }
      )
    )

    const runtime = createYoutubeProducerRuntime(
      {
        channelId: 'channel-1',
        liveVideoId: 'video-1',
        ingestUrl: 'http://127.0.0.1:3000/api/chat/ingest',
        accessToken: 'youtube-access-token'
      },
      {
        createYoutubeClient: vi.fn(() => youtube),
        fetch,
        logger: createLogger().logger
      }
    )

    await runtime.start()
    await listener.handlers.message[0]?.(createYoutubeMessage())

    expect(youtube.chat.sendMessage).not.toHaveBeenCalled()
    expect(youtube.chat.banUser).not.toHaveBeenCalled()
    expect(youtube.chat.timeoutUser).not.toHaveBeenCalled()
  })

  it('uses the async token resolver when an access token is not passed directly', async () => {
    const listener = createMockYoutubeListener()
    const youtube = createMockYoutubeClient(listener)
    const getAccessToken = vi.fn(async () => 'resolved-token')

    const runtime = createYoutubeProducerRuntime(
      {
        channelId: 'channel-1',
        liveVideoId: 'video-1',
        ingestUrl: 'http://127.0.0.1:3000/api/chat/ingest',
        getAccessToken
      },
      {
        createYoutubeClient: vi.fn(() => youtube),
        fetch: vi.fn(async () => new Response(null, { status: 201 })),
        logger: createLogger().logger
      }
    )

    await runtime.start()

    expect(getAccessToken).toHaveBeenCalledTimes(1)
    expect(youtube.chat.listen).toHaveBeenCalledWith(
      expect.objectContaining({ liveVideoId: 'video-1' })
    )
  })

  it('refreshes the token and restarts the listener after a YouTube auth failure', async () => {
    const listener1 = createMockYoutubeListener()
    const listener2 = createMockYoutubeListener()
    const youtube1 = createMockYoutubeClient(listener1)
    const youtube2 = createMockYoutubeClient(listener2)
    const createYoutubeClient = vi
      .fn()
      .mockReturnValueOnce(youtube1)
      .mockReturnValueOnce(youtube2)
    const getAccessToken = vi
      .fn(async () => 'resolved-token-1')
      .mockResolvedValueOnce('resolved-token-1')
      .mockResolvedValueOnce('resolved-token-2')
    const { logger, info, warn, error } = createLogger()

    const runtime = createYoutubeProducerRuntime(
      {
        channelId: 'channel-1',
        liveVideoId: 'video-1',
        ingestUrl: 'http://127.0.0.1:3000/api/chat/ingest',
        getAccessToken
      },
      {
        createYoutubeClient,
        fetch: vi.fn(async () => new Response(null, { status: 201 })),
        logger
      }
    )

    await runtime.start()
    await listener1.handlers.error[0]?.(createYoutubeAuthError())

    expect(getAccessToken).toHaveBeenCalledTimes(2)
    expect(createYoutubeClient).toHaveBeenNthCalledWith(1, {
      accessToken: 'resolved-token-1'
    })
    expect(createYoutubeClient).toHaveBeenNthCalledWith(2, {
      accessToken: 'resolved-token-2'
    })
    expect(listener1.stop).toHaveBeenCalledTimes(1)
    expect(listener2.start).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
      'YouTube chat listener authorization failed; refreshing the token and restarting the listener',
      expect.objectContaining({
        liveVideoId: 'video-1',
        status: 401,
        reason: 'authError'
      })
    )
    expect(info).toHaveBeenCalledWith(
      'Recovered YouTube chat listener after authorization failure',
      expect.objectContaining({
        channelId: 'channel-1',
        recoveryAttempt: 1
      })
    )
    expect(error).not.toHaveBeenCalledWith(
      'YouTube chat listener error',
      expect.anything()
    )
  })

  it('stops the recovered listener after a second YouTube auth failure instead of retrying forever', async () => {
    const listener1 = createMockYoutubeListener()
    const listener2 = createMockYoutubeListener()
    const youtube1 = createMockYoutubeClient(listener1)
    const youtube2 = createMockYoutubeClient(listener2)
    const createYoutubeClient = vi
      .fn()
      .mockReturnValueOnce(youtube1)
      .mockReturnValueOnce(youtube2)
    const getAccessToken = vi
      .fn(async () => 'resolved-token-1')
      .mockResolvedValueOnce('resolved-token-1')
      .mockResolvedValueOnce('resolved-token-2')
    const { logger, warn } = createLogger()

    const runtime = createYoutubeProducerRuntime(
      {
        channelId: 'channel-1',
        liveVideoId: 'video-1',
        ingestUrl: 'http://127.0.0.1:3000/api/chat/ingest',
        getAccessToken
      },
      {
        createYoutubeClient,
        fetch: vi.fn(async () => new Response(null, { status: 201 })),
        logger
      }
    )

    await runtime.start()
    await listener1.handlers.error[0]?.(createYoutubeAuthError())
    await listener2.handlers.error[0]?.(createYoutubeAuthError())

    expect(getAccessToken).toHaveBeenCalledTimes(2)
    expect(createYoutubeClient).toHaveBeenCalledTimes(2)
    expect(listener1.stop).toHaveBeenCalledTimes(1)
    expect(listener2.stop).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
      'YouTube chat listener authorization failed after retry; stopping listener and requiring reauthentication',
      expect.objectContaining({
        liveVideoId: 'video-1',
        attempts: 1,
        status: 401,
        reason: 'authError'
      })
    )
  })

  it('does not create a replacement listener when stop() is called during auth recovery', async () => {
    const listener1 = createMockYoutubeListener()
    const listener2 = createMockYoutubeListener()
    const youtube1 = createMockYoutubeClient(listener1)
    const youtube2 = createMockYoutubeClient(listener2)
    let resolveToken!: (value: string) => void
    const getAccessToken = vi
      .fn(async () => 'resolved-token-1')
      .mockResolvedValueOnce('resolved-token-1')
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            resolveToken = resolve
          })
      )
    const createYoutubeClient = vi
      .fn()
      .mockReturnValueOnce(youtube1)
      .mockReturnValueOnce(youtube2)
    const { logger, warn } = createLogger()

    const runtime = createYoutubeProducerRuntime(
      {
        channelId: 'channel-1',
        liveVideoId: 'video-1',
        ingestUrl: 'http://127.0.0.1:3000/api/chat/ingest',
        getAccessToken
      },
      {
        createYoutubeClient,
        fetch: vi.fn(async () => new Response(null, { status: 201 })),
        logger
      }
    )

    await runtime.start()

    const recoveryPromise = listener1.handlers.error[0]?.(createYoutubeAuthError())
    await Promise.resolve()
    await runtime.stop()
    resolveToken('resolved-token-2')
    await recoveryPromise

    expect(listener1.stop).toHaveBeenCalledTimes(2)
    expect(createYoutubeClient).toHaveBeenCalledTimes(1)
    expect(listener2.start).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(
      'YouTube chat listener authorization failed; refreshing the token and restarting the listener',
      expect.objectContaining({
        liveVideoId: 'video-1',
        recoveryAttempt: 1
      })
    )
  })

  it('stops the listener after a YouTube auth failure when the runtime uses a fixed token', async () => {
    const listener = createMockYoutubeListener()
    const { logger, warn, error } = createLogger()

    const runtime = createYoutubeProducerRuntime(
      {
        channelId: 'channel-1',
        liveVideoId: 'video-1',
        ingestUrl: 'http://127.0.0.1:3000/api/chat/ingest',
        accessToken: 'youtube-access-token'
      },
      {
        createYoutubeClient: vi.fn(() => createMockYoutubeClient(listener)),
        fetch: vi.fn(async () => new Response(null, { status: 201 })),
        logger
      }
    )

    await runtime.start()
    await listener.handlers.error[0]?.(createYoutubeAuthError())

    expect(listener.stop).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
      'YouTube chat listener authorization failed; stopping listener until the runtime is restarted with a valid token',
      expect.objectContaining({
        liveVideoId: 'video-1',
        status: 401,
        reason: 'authError'
      })
    )
    expect(error).not.toHaveBeenCalledWith(
      'YouTube chat listener error',
      expect.anything()
    )
  })

  it('buffers history messages that arrive before start() resolves and flushes them once liveChatId is available', async () => {
    const listener = createMockYoutubeListener()
    const youtube = createMockYoutubeClient(listener)
    const fetch = vi.fn(async () => new Response(null, { status: 201 }))
    const { logger, info, warn } = createLogger()

    let resolveStart!: (value: { liveChatId: string; liveVideoId: string }) => void
    listener.start = vi.fn(
      () =>
        new Promise<{ liveChatId: string; liveVideoId: string }>((resolve) => {
          resolveStart = resolve
        })
    )

    const runtime = createYoutubeProducerRuntime(
      {
        channelId: 'channel-1',
        liveVideoId: 'video-1',
        ingestUrl: 'http://127.0.0.1:3000/api/chat/ingest',
        accessToken: 'youtube-access-token'
      },
      {
        createYoutubeClient: vi.fn(() => youtube),
        fetch,
        logger
      }
    )

    const startPromise = runtime.start()

    await listener.handlers.message[0]?.(
      createYoutubeMessage({ id: 'msg-history-1' })
    )
    await listener.handlers.message[0]?.(
      createYoutubeMessage({ id: 'msg-history-2' })
    )

    resolveStart({ liveChatId: 'live-chat-1', liveVideoId: 'video-1' })
    await startPromise

    expect(fetch).toHaveBeenCalledTimes(2)

    const [, requestInit1] = fetch.mock.calls[0] as unknown as [
      string,
      RequestInit
    ]
    const [, requestInit2] = fetch.mock.calls[1] as unknown as [
      string,
      RequestInit
    ]

    expect(JSON.parse(requestInit1.body as string)).toMatchObject({
      messageId: 'msg-history-1',
      skipQna: true
    })
    expect(JSON.parse(requestInit2.body as string)).toMatchObject({
      messageId: 'msg-history-2',
      skipQna: true
    })

    expect(warn).not.toHaveBeenCalledWith(
      'Skipping YouTube chat message because liveChatId is not available',
      expect.anything()
    )

    expect(info).toHaveBeenCalledWith(
      'Flushing 2 buffered startup-history messages',
      expect.objectContaining({
        channelId: 'channel-1',
        liveVideoId: 'video-1',
        liveChatId: 'live-chat-1'
      })
    )

    expect(info).toHaveBeenCalledWith(
      'YouTube chat message received',
      expect.objectContaining({
        messageId: 'msg-history-1',
        viewerMessage: 'Hello world',
        messageSource: 'history'
      })
    )
    expect(info).toHaveBeenCalledWith(
      'YouTube chat message received',
      expect.objectContaining({
        messageId: 'msg-history-2',
        viewerMessage: 'Hello world',
        messageSource: 'history'
      })
    )
  })
})
