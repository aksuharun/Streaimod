import {
  buildTestChatMessage,
  uniqueTestId
} from '../helpers/factories.js'

describe('test data factories', () => {
  it('creates unique IDs with the requested prefix', () => {
    const firstId = uniqueTestId('message')
    const secondId = uniqueTestId('message')

    expect(firstId).toMatch(/^message-/)
    expect(secondId).toMatch(/^message-/)
    expect(firstId).not.toBe(secondId)
  })

  it('builds realistic chat message input with overrides', () => {
    const message = buildTestChatMessage({
      platform: 'twitch',
      text: 'Where can I find the schedule?'
    })

    expect(message).toMatchObject({
      platform: 'twitch',
      text: 'Where can I find the schedule?'
    })
    expect(message.authorExternalId).toMatch(/^author-/)
    expect(message.channelExternalId).toMatch(/^channel-/)
    expect(new Date(message.sentAt).toString()).not.toBe('Invalid Date')
  })
})
