import { QnaEntry } from '../../src/models/qna-entry.js'
import {
  createEntry,
  importEntries,
  normalizeQuestionText,
  QnaServiceError,
  updateEntry
} from '../../src/services/qna-service.js'
import {
  clearTestDatabase,
  registerTestModel
} from '../helpers/test-database.js'

type FindOneAndUpdateQuery = ReturnType<typeof QnaEntry.findOneAndUpdate>

function rejectedFindOneAndUpdateQuery(error: unknown): FindOneAndUpdateQuery {
  return {
    exec: vi.fn().mockRejectedValueOnce(error)
  } as unknown as FindOneAndUpdateQuery
}

describe('normalizeQuestionText', () => {
  it('trims whitespace, lowercases, and collapses whitespace', () => {
    expect(normalizeQuestionText('  Hello   World  ')).toBe('hello world')
  })

  it('removes leading question marks', () => {
    expect(normalizeQuestionText('??What is this')).toBe('what is this')
  })

  it('removes trailing question marks', () => {
    expect(normalizeQuestionText('How are you??')).toBe('how are you')
  })

  it('removes chat-style trailing question punctuation', () => {
    expect(normalizeQuestionText('How are you?!')).toBe('how are you')
    expect(normalizeQuestionText('How are you??!')).toBe('how are you')
  })

  it('removes fullwidth question marks', () => {
    expect(normalizeQuestionText('How are you\uFF1F')).toBe('how are you')
  })

  it('removes both leading and trailing question marks', () => {
    expect(normalizeQuestionText('?? What is this ??')).toBe('what is this')
  })

  it('preserves question marks in the middle of text and strips trailing ones', () => {
    expect(normalizeQuestionText('What? Why? How?')).toBe('what? why? how')
  })

  it('returns empty string for whitespace-only input', () => {
    expect(normalizeQuestionText('   ')).toBe('')
  })

  it('returns empty string for question-mark-only input', () => {
    expect(normalizeQuestionText('???')).toBe('')
  })

  it('handles mixed punctuation and whitespace', () => {
    expect(normalizeQuestionText(' ? Hello? ')).toBe('hello')
  })

  it('does not remove non-question punctuation', () => {
    expect(normalizeQuestionText('Hello, world!')).toBe('hello, world!')
  })

  it('normalizes Turkish diacritics to ASCII equivalents', () => {
    expect(normalizeQuestionText('Yasin kaç?')).toBe('yasin kac')
    expect(normalizeQuestionText('KAÇ YAŞINDASIN?')).toBe('kac yasindasin')
  })
})

describe('createEntry', () => {
  beforeAll(() => {
    registerTestModel(QnaEntry)
  })

  beforeEach(async () => {
    await clearTestDatabase()
  })

  it('trims channelId before storing', async () => {
    const entry = await createEntry({
      channelId: '  ch-trimmed  ',
      question: 'Hello?',
      answer: 'World'
    })

    expect(entry.channelId).toBe('ch-trimmed')
  })

  it('rejects a question that normalizes to empty', async () => {
    await expect(
      createEntry({
        channelId: 'ch-1',
        question: '???',
        answer: 'World'
      })
    ).rejects.toThrow(QnaServiceError)
  })

  it('rejects a duplicate question in the same channel', async () => {
    await createEntry({
      channelId: 'ch-1',
      question: 'Hello?',
      answer: 'World'
    })

    await expect(
      createEntry({
        channelId: 'ch-1',
        question: '  HELLO??  ',
        answer: 'Another'
      })
    ).rejects.toThrow(QnaServiceError)
  })

  it('allows same normalized question in different channels', async () => {
    await createEntry({
      channelId: 'ch-a',
      question: 'Hello?',
      answer: 'A'
    })

    const entryB = await createEntry({
      channelId: 'ch-b',
      question: 'Hello?',
      answer: 'B'
    })

    expect(entryB.channelId).toBe('ch-b')
    expect(entryB.normalizedQuestion).toBe('hello')
  })

  it('treats Turkish and ASCII spellings as duplicate questions', async () => {
    await createEntry({
      channelId: 'ch-1',
      question: 'Yasin kaç?',
      answer: '22'
    })

    await expect(
      createEntry({
        channelId: 'ch-1',
        question: 'Yasin kac?',
        answer: '22'
      })
    ).rejects.toThrow(QnaServiceError)
  })

  it('converts a DB duplicate-key error from QnaEntry.create to QnaServiceError DUPLICATE_QUESTION', async () => {
    const duplicateError = Object.assign(
      new Error('E11000 duplicate key error collection'),
      { code: 11000 }
    )

    vi.spyOn(QnaEntry, 'create').mockRejectedValueOnce(duplicateError)

    await expect(
      createEntry({
        channelId: 'ch-1',
        question: 'Hello?',
        answer: 'World'
      })
    ).rejects.toMatchObject({
      name: 'QnaServiceError',
      code: 'DUPLICATE_QUESTION',
      message: 'An entry with this question already exists in this channel'
    })
  })

  it('re-throws non-duplicate-key errors from QnaEntry.create unchanged', async () => {
    const otherError = new Error('Some other DB error')
    vi.spyOn(QnaEntry, 'create').mockRejectedValueOnce(otherError)

    await expect(
      createEntry({
        channelId: 'ch-1',
        question: 'Hello?',
        answer: 'World'
      })
    ).rejects.toThrow('Some other DB error')
  })
})

describe('updateEntry', () => {
  beforeAll(() => {
    registerTestModel(QnaEntry)
  })

  beforeEach(async () => {
    await clearTestDatabase()
  })

  it('rejects an updated question that normalizes to empty', async () => {
    const entry = await createEntry({
      channelId: 'ch-1',
      question: 'Hello?',
      answer: 'World'
    })

    await expect(
      updateEntry(String(entry._id), { question: '???' })
    ).rejects.toThrow(QnaServiceError)
  })

  it('rejects an update to a question that already exists in the same channel', async () => {
    const first = await createEntry({
      channelId: 'ch-1',
      question: 'First?',
      answer: 'A'
    })

    const second = await createEntry({
      channelId: 'ch-1',
      question: 'Second?',
      answer: 'B'
    })

    await expect(
      updateEntry(String(second._id), { question: '  First??  ' })
    ).rejects.toThrow(QnaServiceError)
  })

  it('allows updating to its own unchanged normalized question', async () => {
    const entry = await createEntry({
      channelId: 'ch-1',
      question: 'Hello?',
      answer: 'World'
    })

    const updated = await updateEntry(String(entry._id), {
      question: '  Hello?  '
    })

    expect(updated).not.toBeNull()
    expect(updated!.normalizedQuestion).toBe('hello')
  })

  it('converts a DB duplicate-key error from findOneAndUpdate to QnaServiceError DUPLICATE_QUESTION', async () => {
    const entry = await createEntry({
      channelId: 'ch-1',
      question: 'Old question',
      answer: 'Old answer'
    })

    const duplicateError = Object.assign(
      new Error('E11000 duplicate key error collection'),
      { code: 11000 }
    )

    vi.spyOn(QnaEntry, 'findOneAndUpdate').mockReturnValue(
      rejectedFindOneAndUpdateQuery(duplicateError)
    )

    await expect(
      updateEntry(String(entry._id), { question: 'New question' })
    ).rejects.toMatchObject({
      name: 'QnaServiceError',
      code: 'DUPLICATE_QUESTION',
      message: 'An entry with this question already exists in this channel'
    })
  })

  it('re-throws non-duplicate-key errors from findOneAndUpdate unchanged', async () => {
    const entry = await createEntry({
      channelId: 'ch-1',
      question: 'Old question',
      answer: 'Old answer'
    })

    const otherError = new Error('Some other DB error')

    vi.spyOn(QnaEntry, 'findOneAndUpdate').mockReturnValue(
      rejectedFindOneAndUpdateQuery(otherError)
    )

    await expect(
      updateEntry(String(entry._id), { question: 'New question' })
    ).rejects.toThrow('Some other DB error')
  })
})

describe('importEntries', () => {
  beforeAll(() => {
    registerTestModel(QnaEntry)
  })

  beforeEach(async () => {
    await clearTestDatabase()
  })

  it('creates new entries and defaults enabled to true', async () => {
    const result = await importEntries(' channel-1 ', [
      {
        question: 'What is the schedule?',
        answer: 'Weekdays at 3 PM EST'
      }
    ])

    expect(result).toMatchObject({
      createdCount: 1,
      updatedCount: 0,
      unchangedCount: 0,
      totalCount: 1
    })
    expect(result.entries[0]?.channelId).toBe('channel-1')
    expect(result.entries[0]?.enabled).toBe(true)
  })

  it('updates an existing entry matched by normalized question', async () => {
    await createEntry({
      channelId: 'channel-1',
      question: 'What is the schedule?',
      answer: 'Old answer',
      enabled: true
    })

    const result = await importEntries('channel-1', [
      {
        question: '  WHAT IS THE SCHEDULE?? ',
        answer: 'New answer',
        enabled: false
      }
    ])

    expect(result).toMatchObject({
      createdCount: 0,
      updatedCount: 1,
      unchangedCount: 0,
      totalCount: 1
    })
    expect(result.entries[0]?.question).toBe('WHAT IS THE SCHEDULE??')
    expect(result.entries[0]?.answer).toBe('New answer')
    expect(result.entries[0]?.enabled).toBe(false)
  })

  it('counts unchanged entries separately', async () => {
    await createEntry({
      channelId: 'channel-1',
      question: 'What is the schedule?',
      answer: 'Weekdays at 3 PM EST',
      enabled: true
    })

    const result = await importEntries('channel-1', [
      {
        question: 'What is the schedule?',
        answer: 'Weekdays at 3 PM EST',
        enabled: true
      }
    ])

    expect(result).toMatchObject({
      createdCount: 0,
      updatedCount: 0,
      unchangedCount: 1,
      totalCount: 1
    })
  })

  it('rejects duplicated normalized questions inside the payload', async () => {
    await expect(
      importEntries('channel-1', [
        {
          question: 'Yasin kaç?',
          answer: '22'
        },
        {
          question: 'Yasin kac?',
          answer: '22'
        }
      ])
    ).rejects.toMatchObject({
      name: 'QnaServiceError',
      code: 'DUPLICATE_IMPORT_QUESTION'
    })
  })

  it('rejects a payload entry whose question normalizes to empty', async () => {
    await expect(
      importEntries('channel-1', [
        {
          question: '???',
          answer: 'Nope'
        }
      ])
    ).rejects.toMatchObject({
      name: 'QnaServiceError',
      code: 'NORMALIZED_EMPTY'
    })
  })
})
