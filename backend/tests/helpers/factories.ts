let sequence = 0

export type TestChatMessageInput = {
  authorExternalId: string
  channelExternalId: string
  platform: 'youtube' | 'twitch' | 'kick'
  sentAt: string
  text: string
}

export type TestChatCommandInput = {
  channelId: string
  trigger: string
  replyText: string
  enabled: boolean
}

export function uniqueTestId(prefix = 'test'): string {
  sequence += 1
  return `${prefix}-${Date.now()}-${sequence}`
}

export function buildTestChatMessage(
  overrides: Partial<TestChatMessageInput> = {}
): TestChatMessageInput {
  return {
    authorExternalId: uniqueTestId('author'),
    channelExternalId: uniqueTestId('channel'),
    platform: 'youtube',
    sentAt: new Date().toISOString(),
    text: 'How do I join the stream?',
    ...overrides
  }
}

export function buildTestChatCommand(
  overrides: Partial<TestChatCommandInput> = {}
): TestChatCommandInput {
  const suffix = uniqueTestId('command')

  return {
    channelId: uniqueTestId('channel'),
    trigger: `!${suffix}`,
    replyText: `https://example.com/${suffix}`,
    enabled: true,
    ...overrides
  }
}
