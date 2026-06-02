import { ChatCommand } from '../../src/models/chat-command.js'
import {
  createChatCommand,
  deleteChatCommand,
  getChatCommand,
  listChatCommands,
  matchChatCommand,
  normalizeChatCommandTrigger,
  updateChatCommand
} from '../../src/services/chat-command-service.js'
import { buildTestChatCommand, uniqueTestId } from '../helpers/factories.js'
import {
  clearTestDatabase,
  registerTestModel
} from '../helpers/test-database.js'

describe('chat-command-service', () => {
  beforeAll(() => {
    registerTestModel(ChatCommand)
  })

  beforeEach(async () => {
    await clearTestDatabase()
  })

  it('normalizes command triggers for case-insensitive matching', () => {
    expect(normalizeChatCommandTrigger('  !LinkTree   Now  ')).toBe('!linktree now')
  })

  it('creates a command with a normalized trigger', async () => {
    const input = buildTestChatCommand()

    const command = await createChatCommand(input)

    expect(command.channelId).toBe(input.channelId)
    expect(command.trigger).toBe(input.trigger)
    expect(command.normalizedTrigger).toBe(input.trigger.toLowerCase())
    expect(command.replyText).toBe(input.replyText)
    expect(command.enabled).toBe(true)
  })

  it('rejects triggers that do not start with !', async () => {
    await expect(
      createChatCommand({
        channelId: uniqueTestId('ch'),
        trigger: 'linktree',
        replyText: 'https://linktr.ee/test'
      })
    ).rejects.toMatchObject({
      code: 'INVALID_TRIGGER_PREFIX'
    })
  })

  it('rejects duplicate triggers within the same channel', async () => {
    const channelId = uniqueTestId('ch')

    await createChatCommand({
      channelId,
      trigger: '!LinkTree',
      replyText: 'first'
    })

    await expect(
      createChatCommand({
        channelId,
        trigger: '!linktree',
        replyText: 'second'
      })
    ).rejects.toMatchObject({
      code: 'DUPLICATE_TRIGGER'
    })
  })

  it('lists commands newest first', async () => {
    const channelId = uniqueTestId('ch')

    await createChatCommand({
      channelId,
      trigger: '!first',
      replyText: 'First'
    })
    await new Promise((resolve) => setTimeout(resolve, 5))
    await createChatCommand({
      channelId,
      trigger: '!second',
      replyText: 'Second'
    })

    const commands = await listChatCommands(channelId)

    expect(commands).toHaveLength(2)
    expect(commands[0]?.trigger).toBe('!second')
    expect(commands[1]?.trigger).toBe('!first')
  })

  it('updates trigger, reply text, and enabled state', async () => {
    const created = await createChatCommand(buildTestChatCommand())

    const updated = await updateChatCommand(String(created._id), {
      trigger: '!socials',
      replyText: 'https://example.com/socials',
      enabled: false
    })

    expect(updated).not.toBeNull()
    expect(updated?.trigger).toBe('!socials')
    expect(updated?.normalizedTrigger).toBe('!socials')
    expect(updated?.replyText).toBe('https://example.com/socials')
    expect(updated?.enabled).toBe(false)
  })

  it('matches enabled commands by normalized message text', async () => {
    const created = await createChatCommand({
      channelId: uniqueTestId('ch'),
      trigger: '!linktree',
      replyText: 'https://linktr.ee/mylink'
    })

    const result = await matchChatCommand({
      channelId: created.channelId,
      messageText: '  !LinkTree  '
    })

    expect(result).toMatchObject({
      matched: true,
      replyText: 'https://linktr.ee/mylink'
    })
    expect(result.matched && result.command.trigger).toBe('!linktree')
  })

  it('does not match disabled commands or plain text messages', async () => {
    const created = await createChatCommand({
      channelId: uniqueTestId('ch'),
      trigger: '!linktree',
      replyText: 'https://linktr.ee/mylink',
      enabled: false
    })

    await expect(getChatCommand(String(created._id))).resolves.not.toBeNull()

    await expect(
      matchChatCommand({
        channelId: created.channelId,
        messageText: '!linktree'
      })
    ).resolves.toEqual({ matched: false })

    await expect(
      matchChatCommand({
        channelId: created.channelId,
        messageText: 'hello chat'
      })
    ).resolves.toEqual({ matched: false })
  })

  it('deletes commands by id', async () => {
    const created = await createChatCommand(buildTestChatCommand())

    await expect(deleteChatCommand(String(created._id))).resolves.toBe(true)
    await expect(getChatCommand(String(created._id))).resolves.toBeNull()
  })
})
