import {
  createYoutubeClient,
  Platform,
  PlatformApiError,
  type ChatMessage as YoutubeChatMessage,
  type YoutubeChatClient,
  type YoutubeChatListener,
  type YoutubeClient,
  type YoutubeClientConfig
} from 'unified-creator-metrics'

import {
  markChatActionFailed,
  markChatActionSucceeded,
  reserveChatAction
} from '../services/chat-action-service.js'

interface ChatIngestPayload {
  channelId: string
  messageId: string
  authorExternalId: string
  channelExternalId: string
  platform: 'youtube'
  sentAt: string
  text: string
  skipQna?: boolean
}

export interface YoutubeProducerConfig {
  channelId: string
  liveVideoId: string
  ingestUrl: string
  accessToken?: string
  getAccessToken?: () => Promise<string>
  pollingIntervalMs?: number
  maxResults?: number
  includeHistory?: boolean
  timeoutDurationSeconds?: number
}

export interface YoutubeProducerLogger {
  info(message: string, meta?: unknown): void
  warn(message: string, meta?: unknown): void
  error(message: string, meta?: unknown): void
}

export interface YoutubeProducerRuntime {
  start(): Promise<void>
  stop(): Promise<void>
}

interface YoutubeProducerDependencies {
  createYoutubeClient: (config: YoutubeClientConfig) => YoutubeClient
  fetch: typeof globalThis.fetch
  logger: YoutubeProducerLogger
}

interface ChatIngestResponse {
  duplicate: boolean
  event: {
    channelId: string
    messageId: string
    authorExternalId: string
    platform: 'youtube'
  } | null
  command: {
    matched: boolean
    replyText?: string
    command?: { id: string; trigger: string }
  } | null
  qna: {
    agent?: string
    matched: boolean
    action: 'SEND_ANSWER' | 'DO_NOTHING'
    answer?: string
    entry?: { id: string }
  } | null
  moderation: {
    agent?: string
    action: 'BAN' | 'TIMEOUT' | 'IGNORE'
    catalogId: string | null
    reason: string | null
    workflow?: {
      unicodeCount: number
      normalized: boolean
      normalizedMessage: string
      banSkipped: boolean
      banAction: 'BAN' | 'TIMEOUT' | 'IGNORE' | null
      banCatalogId: string | null
      banReason: string | null
      timeoutSkipped: boolean
      timeoutAction: 'BAN' | 'TIMEOUT' | 'IGNORE' | null
      timeoutCatalogId: string | null
      timeoutReason: string | null
    }
  } | null
}

interface YoutubePlatformErrorDetail {
  status: number | null
  reason: string | null
  message: string | null
}

const defaultLogger: YoutubeProducerLogger = {
  info: (message, meta) => console.info(message, meta),
  warn: (message, meta) => console.warn(message, meta),
  error: (message, meta) => console.error(message, meta)
}

const DEFAULT_TIMEOUT_DURATION_SECONDS = 15
const MAX_LISTENER_AUTH_RECOVERY_ATTEMPTS = 1

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function truncateForLog(value: string, maxLength = 120): string {
  const trimmed = value.trim()

  if (trimmed.length <= maxLength) {
    return trimmed
  }

  return `${trimmed.slice(0, maxLength - 3)}...`
}

function logModerationWorkflowStage({
  logger,
  stage,
  message,
  liveChatId,
  moderationAgent,
  payload
}: {
  logger: YoutubeProducerLogger
  stage: 'normalize' | 'ban' | 'timeout'
  message: YoutubeChatMessage
  liveChatId: string
  moderationAgent: string | null
  payload: Record<string, unknown>
}): void {
  const label =
    stage === 'normalize'
      ? 'Normalize agent resolved'
      : stage === 'ban'
        ? 'Ban agent resolved'
        : 'Timeout agent resolved'

  logger.info(label, {
    messageId: message.id,
    liveChatId,
    viewerMessage: truncateForLog(message.text, 200),
    moderationAgent,
    stageAgent: stage,
    ...payload
  })
}

function extractYoutubePlatformErrorDetail(error: unknown): YoutubePlatformErrorDetail {
  const fallbackMessage = error instanceof Error ? error.message.trim() : null

  if (!(error instanceof PlatformApiError)) {
    return {
      status: null,
      reason: null,
      message: fallbackMessage
    }
  }

  const fallbackStatus = typeof error.status === 'number' ? error.status : null
  const cause = error.cause

  if (!cause || typeof cause !== 'object') {
    return {
      status: fallbackStatus,
      reason: null,
      message: fallbackMessage
    }
  }

  const causeRecord = cause as Record<string, unknown>
  const response =
    causeRecord.response && typeof causeRecord.response === 'object'
      ? (causeRecord.response as Record<string, unknown>)
      : null
  const responseData =
    response?.data && typeof response.data === 'object'
      ? (response.data as Record<string, unknown>)
      : null
  const topLevelError =
    responseData?.error && typeof responseData.error === 'object'
      ? (responseData.error as Record<string, unknown>)
      : null
  const errors = Array.isArray(topLevelError?.errors)
    ? topLevelError.errors
    : Array.isArray(responseData?.errors)
      ? responseData.errors
      : []
  const firstError =
    errors[0] && typeof errors[0] === 'object' ? (errors[0] as Record<string, unknown>) : null
  const status =
    typeof response?.status === 'number'
      ? response.status
      : typeof causeRecord.status === 'number'
        ? causeRecord.status
        : fallbackStatus
  const reason =
    typeof firstError?.reason === 'string' && firstError.reason.trim().length > 0
      ? firstError.reason.trim()
      : null
  const message =
    typeof topLevelError?.message === 'string' && topLevelError.message.trim().length > 0
      ? topLevelError.message.trim()
      : typeof causeRecord.message === 'string' && causeRecord.message.trim().length > 0
        ? causeRecord.message.trim()
        : fallbackMessage

  return {
    status,
    reason,
    message
  }
}

function isYoutubeAuthorizationError(detail: YoutubePlatformErrorDetail): boolean {
  const reason = detail.reason?.toLowerCase() ?? null

  return (
    detail.status === 401 ||
    reason === 'autherror' ||
    reason === 'insufficientpermissions'
  )
}

function getYoutubeAuthorMention(message: YoutubeChatMessage): string | null {
  const handle = isNonEmptyString(message.author.username)
    ? message.author.username.trim()
    : isNonEmptyString(message.author.displayName)
      ? message.author.displayName.trim()
      : null

  if (!handle) {
    return null
  }

  return handle.startsWith('@') ? handle : `@${handle}`
}

function buildYoutubeQnaReplyText(
  message: YoutubeChatMessage,
  answer: string
): string {
  const mention = getYoutubeAuthorMention(message)
  const trimmedAnswer = answer.trim()

  if (!mention) {
    return trimmedAnswer
  }

  return `${mention} ${trimmedAnswer}`
}

function createDefaultDependencies(): YoutubeProducerDependencies {
  return {
    createYoutubeClient,
    fetch: globalThis.fetch,
    logger: defaultLogger
  }
}

async function postToChatIngest(
  payload: ChatIngestPayload,
  config: YoutubeProducerConfig,
  dependencies: YoutubeProducerDependencies
): Promise<ChatIngestResponse | null> {
  const response = await dependencies.fetch(config.ingestUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  })

  if (response.status === 200 || response.status === 201) {
    const responseText = await response.text()

    if (!responseText.trim()) {
      return null
    }

    return JSON.parse(responseText) as ChatIngestResponse
  }

  const responseBody = await response.text()
  const details = responseBody.length > 0 ? `: ${responseBody}` : ''

  throw new Error(
    `POST ${config.ingestUrl} returned ${response.status}${details}`
  )
}

async function handleYoutubeMessage(
  message: YoutubeChatMessage,
  config: YoutubeProducerConfig,
  dependencies: YoutubeProducerDependencies,
  liveChatId: string,
  getChatClient: () => Promise<YoutubeChatClient>,
  actionsEnabled: boolean,
  skipQna: boolean = false
): Promise<void> {
  if (!isNonEmptyString(message.author.id)) {
    dependencies.logger.warn(
      'Skipping YouTube chat message because author.id is missing',
      {
        messageId: message.id,
        liveVideoId: config.liveVideoId
      }
    )
    return
  }

  if (!isNonEmptyString(message.channel.id)) {
    dependencies.logger.warn(
      'Skipping YouTube chat message because channel.id is missing',
      {
        messageId: message.id,
        liveVideoId: config.liveVideoId
      }
    )
    return
  }

  const authorId = message.author.id
  const channelExternalId = message.channel.id

  if (authorId === channelExternalId) {
    return
  }

  const ingestResult = await postToChatIngest(
    {
      channelId: config.channelId,
      messageId: message.id,
      authorExternalId: authorId,
      channelExternalId,
      platform: Platform.YouTube,
      sentAt: message.sentAt,
      text: message.text,
      ...(skipQna ? { skipQna: true } : {})
    },
    config,
    dependencies
  )

  await executeIngestActions({
    ingestResult,
    message,
    config,
    liveChatId,
    authorId,
    getChatClient,
    actionsEnabled,
    logger: dependencies.logger
  })
}

async function executeReservedAction<TResponse>(
  actionInput: Parameters<typeof reserveChatAction>[0],
  execute: () => Promise<TResponse>,
  logger: YoutubeProducerLogger
): Promise<{ executed: boolean; response?: TResponse }> {
  const reservation = await reserveChatAction(actionInput)

  if (!reservation.reserved) {
    return { executed: false }
  }

  try {
    const response = await execute()
    await markChatActionSucceeded(reservation.action._id, response)
    return { executed: true, response }
  } catch (error) {
    await markChatActionFailed(reservation.action._id, error)
    throw error
  }
}

async function executeIngestActions({
  ingestResult,
  message,
  config,
  liveChatId,
  authorId,
  getChatClient,
  actionsEnabled,
  logger
}: {
  ingestResult: ChatIngestResponse | null
  message: YoutubeChatMessage
  config: YoutubeProducerConfig
  liveChatId: string
  authorId: string
  getChatClient: () => Promise<YoutubeChatClient>
  actionsEnabled: boolean
  logger: YoutubeProducerLogger
}): Promise<void> {
  if (!ingestResult || ingestResult.duplicate) {
    return
  }

  const moderation = ingestResult.moderation
  const command = ingestResult.command
  const qna = ingestResult.qna
  const commandReplyText =
    command?.matched === true &&
    typeof command.replyText === 'string' &&
    command.replyText.trim().length > 0
      ? command.replyText.trim()
      : null
  const qnaReplyText =
    qna?.matched === true &&
    qna.action === 'SEND_ANSWER' &&
    typeof qna.answer === 'string' &&
    qna.answer.trim().length > 0
      ? buildYoutubeQnaReplyText(message, qna.answer)
      : null
  const selectedAction =
    moderation?.action === 'BAN'
      ? 'BAN'
      : moderation?.action === 'TIMEOUT'
        ? 'TIMEOUT'
        : commandReplyText !== null
          ? 'COMMAND_REPLY'
          : qnaReplyText !== null
          ? 'SEND_ANSWER'
          : 'NONE'
  const baseActionInput = {
    channelId: config.channelId,
    platform: Platform.YouTube,
    messageId: message.id,
    liveChatId,
    authorExternalId: authorId
  } as const

  const hasAction =
    moderation?.action === 'BAN' ||
    moderation?.action === 'TIMEOUT' ||
    commandReplyText !== null ||
    qnaReplyText !== null

  if (hasAction && !actionsEnabled) {
    logger.warn(
      'Skipping YouTube chat actions because the producer is not configured with OAuth access',
      {
        messageId: message.id,
        liveChatId,
        moderationAction: moderation?.action,
        commandMatched: command?.matched,
        qnaAction: qna?.action
      }
    )
    return
  }

  if (moderation?.workflow) {
    logModerationWorkflowStage({
      logger,
      stage: 'normalize',
      message,
      liveChatId,
      moderationAgent: moderation.agent ?? null,
      payload: {
        unicodeCount: moderation.workflow.unicodeCount,
        normalized: moderation.workflow.normalized,
        normalizedMessage: moderation.workflow.normalizedMessage
      }
    })

    logModerationWorkflowStage({
      logger,
      stage: 'ban',
      message,
      liveChatId,
      moderationAgent: moderation.agent ?? null,
      payload: {
        skipped: moderation.workflow.banSkipped,
        action: moderation.workflow.banAction,
        catalogId: moderation.workflow.banCatalogId,
        reason: moderation.workflow.banReason
      }
    })

    logModerationWorkflowStage({
      logger,
      stage: 'timeout',
      message,
      liveChatId,
      moderationAgent: moderation.agent ?? null,
      payload: {
        skipped: moderation.workflow.timeoutSkipped,
        action: moderation.workflow.timeoutAction,
        catalogId: moderation.workflow.timeoutCatalogId,
        reason: moderation.workflow.timeoutReason
      }
    })
  }

  const chatClient = await getChatClient()

  if (moderation?.action === 'BAN') {
    await executeReservedAction(
      {
        ...baseActionInput,
        type: 'ban',
        catalogId: moderation.catalogId,
        reason: moderation.reason,
        request: {
          liveChatId,
          userId: authorId
        }
      },
      () =>
        chatClient.banUser({
          liveChatId,
          userId: authorId
        }),
      logger
    )
    return
  }

  if (moderation?.action === 'TIMEOUT') {
    const durationSeconds =
      config.timeoutDurationSeconds ?? DEFAULT_TIMEOUT_DURATION_SECONDS

    await executeReservedAction(
      {
        ...baseActionInput,
        type: 'timeout',
        catalogId: moderation.catalogId,
        reason: moderation.reason,
        request: {
          liveChatId,
          userId: authorId,
          durationSeconds
        }
      },
      () =>
        chatClient.timeoutUser({
          liveChatId,
          userId: authorId,
          durationSeconds
        }),
      logger
    )
    return
  }

  if (commandReplyText !== null) {
    await executeReservedAction(
      {
        ...baseActionInput,
        type: 'command_reply',
        reason: command?.command?.trigger ?? null,
        request: {
          liveChatId,
          commandId: command?.command?.id ?? null,
          trigger: command?.command?.trigger ?? null,
          text: commandReplyText
        }
      },
      () =>
        chatClient.sendMessage({
          liveChatId,
          text: commandReplyText
        }),
      logger
    )
    return
  }

  if (qnaReplyText !== null) {
    const replyText = qnaReplyText
    const qnaEntryId = qna?.entry?.id ?? null

    const actionResult = await executeReservedAction(
      {
        ...baseActionInput,
        type: 'qna_reply',
        qnaEntryId,
        request: {
          liveChatId,
          text: replyText
        }
      },
      () =>
        chatClient.sendMessage({
          liveChatId,
          text: replyText
        }),
      logger
    )

    if (actionResult.executed) {
      logger.info('Q&A response sent', {
        messageId: message.id,
        liveChatId,
        responseAgent: qna?.agent ?? null,
        qnaEntryId,
        textPreview: truncateForLog(replyText)
      })
    }

    return
  }

  return
}

export function createYoutubeProducerRuntime(
  config: YoutubeProducerConfig,
  providedDependencies: Partial<YoutubeProducerDependencies> = {}
): YoutubeProducerRuntime {
  const dependencies: YoutubeProducerDependencies = {
    ...createDefaultDependencies(),
    ...providedDependencies
  }

  let listener: YoutubeChatListener | null = null
  let liveChatId: string | null = null
  let stopped = true
  let authRecoveryAttempts = 0
  let authRecoveryInProgress = false

  const resolveRuntimeAccessToken = async (): Promise<string> => {
    const accessToken = config.accessToken ?? (await config.getAccessToken?.())

    if (!accessToken) {
      throw new Error(
        'A YouTube OAuth access token is required to start the stream runtime'
      )
    }

    return accessToken
  }

  const getActionChatClient = async (): Promise<YoutubeChatClient> => {
    const accessToken = await resolveRuntimeAccessToken()
    return dependencies.createYoutubeClient({ accessToken }).chat
  }

  return {
    async start(): Promise<void> {
      if (listener) {
        return
      }

      const bufferedMessages: YoutubeChatMessage[] = []

      const activateListener = async (
        accessToken: string,
        recoveryAttempt: number | null = null
      ): Promise<void> => {
        if (stopped) {
          return
        }

        const youtube = dependencies.createYoutubeClient({
          accessToken
        })
        const nextListener = youtube.chat.listen({
          liveVideoId: config.liveVideoId,
          pollingIntervalMs: config.pollingIntervalMs,
          maxResults: config.maxResults,
          includeHistory: config.includeHistory ?? true
        })

        listener = nextListener

        nextListener.on('message', async (message) => {
          if (listener !== nextListener || stopped) {
            return
          }

          try {
            if (!liveChatId) {
              bufferedMessages.push(message)
              return
            }

            await handleYoutubeMessage(
              message,
              config,
              dependencies,
              liveChatId,
              getActionChatClient,
              true
            )
          } catch (error) {
            dependencies.logger.error(
              'Failed to ingest YouTube chat message',
              {
                error,
                messageId: message.id,
                liveVideoId: config.liveVideoId
              }
            )
          }
        })

        nextListener.on('error', async (error) => {
          if (listener !== nextListener || stopped) {
            return
          }

          const detail = extractYoutubePlatformErrorDetail(error)

          if (isYoutubeAuthorizationError(detail)) {
            if (authRecoveryInProgress) {
              return
            }

            if (!config.getAccessToken || config.accessToken) {
              dependencies.logger.warn(
                'YouTube chat listener authorization failed; stopping listener until the runtime is restarted with a valid token',
                {
                  liveVideoId: config.liveVideoId,
                  status: detail.status,
                  reason: detail.reason,
                  message: detail.message
                }
              )

              authRecoveryInProgress = true

              try {
                await nextListener.stop()
              } finally {
                if (listener === nextListener) {
                  listener = null
                  liveChatId = null
                }
                authRecoveryInProgress = false
              }

              return
            }

            if (authRecoveryAttempts >= MAX_LISTENER_AUTH_RECOVERY_ATTEMPTS) {
              dependencies.logger.warn(
                'YouTube chat listener authorization failed after retry; stopping listener and requiring reauthentication',
                {
                  liveVideoId: config.liveVideoId,
                  status: detail.status,
                  reason: detail.reason,
                  message: detail.message,
                  attempts: authRecoveryAttempts
                }
              )

              authRecoveryInProgress = true

              try {
                await nextListener.stop()
              } finally {
                if (listener === nextListener) {
                  listener = null
                  liveChatId = null
                }
                authRecoveryInProgress = false
              }

              return
            }

            authRecoveryAttempts += 1
            authRecoveryInProgress = true

            dependencies.logger.warn(
              'YouTube chat listener authorization failed; refreshing the token and restarting the listener',
              {
                liveVideoId: config.liveVideoId,
                status: detail.status,
                reason: detail.reason,
                message: detail.message,
                recoveryAttempt: authRecoveryAttempts
              }
            )

            try {
              await nextListener.stop().catch(() => undefined)

              if (listener === nextListener) {
                listener = null
                liveChatId = null
              }

              const refreshedAccessToken = await resolveRuntimeAccessToken()

              if (stopped) {
                return
              }

              await activateListener(refreshedAccessToken, authRecoveryAttempts)
            } catch (recoveryError) {
              const recoveryDetail = extractYoutubePlatformErrorDetail(recoveryError)

              dependencies.logger.error(
                'Failed to recover the YouTube chat listener after an authorization error',
                {
                  liveVideoId: config.liveVideoId,
                  status: recoveryDetail.status,
                  reason: recoveryDetail.reason,
                  message: recoveryDetail.message,
                  error:
                    recoveryDetail.message === null ? recoveryError : undefined
                }
              )

              listener = null
              liveChatId = null
            } finally {
              authRecoveryInProgress = false
            }

            return
          }

          dependencies.logger.error('YouTube chat listener error', {
            liveVideoId: config.liveVideoId,
            status: detail.status,
            reason: detail.reason,
            message: detail.message,
            error: detail.message === null ? error : undefined
          })
        })

        try {
          const startResult = await nextListener.start()

          if (stopped || listener !== nextListener) {
            await nextListener.stop().catch(() => undefined)
            return
          }

          liveChatId = startResult.liveChatId

          if (bufferedMessages.length > 0) {
            const messagesToFlush = bufferedMessages.splice(0, bufferedMessages.length)
            for (const bufferedMessage of messagesToFlush) {
              try {
                await handleYoutubeMessage(
                  bufferedMessage,
                  config,
                  dependencies,
                  liveChatId,
                  getActionChatClient,
                  true,
                  true
                )
              } catch (error) {
                dependencies.logger.error(
                  'Failed to ingest buffered YouTube chat message',
                  {
                    error,
                    messageId: bufferedMessage.id,
                    liveVideoId: config.liveVideoId
                  }
                )
              }
            }
          }
        } catch (error) {
          if (listener === nextListener) {
            listener = null
            liveChatId = null
          }

          await nextListener.stop().catch(() => undefined)
          throw error
        }
      }

      stopped = false

      try {
        const accessToken = config.accessToken ?? (await resolveRuntimeAccessToken())
        await activateListener(accessToken)
      } catch (error) {
        stopped = true
        throw error
      }
    },

    async stop(): Promise<void> {
      stopped = true

      if (!listener) {
        return
      }

      const activeListener = listener
      listener = null
      liveChatId = null

      await activeListener.stop()
    }
  }
}
