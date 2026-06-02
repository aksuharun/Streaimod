import {
  getOptionalEnv,
  getRequiredEnv,
  runBackendStartupPreflight
} from '../../src/config/env.js'
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

describe('runBackendStartupPreflight', () => {
  const startupEnv = {
    RAISON_QNA_PROMPT_ID: 'qna-prompt-1',
    RAISON_NORMALIZE_PROMPT_ID: 'normalize-prompt-1',
    RAISON_BAN_PROMPT_ID: 'ban-prompt-1',
    RAISON_TIMEOUT_PROMPT_ID: 'timeout-prompt-1'
  }

  it('passes when the backend startup env is complete', async () => {
    await withTemporaryEnv(startupEnv, async () => {
      expect(() => runBackendStartupPreflight()).not.toThrow()
    })
  })

  it.each([
    'RAISON_QNA_PROMPT_ID',
    'RAISON_NORMALIZE_PROMPT_ID',
    'RAISON_BAN_PROMPT_ID',
    'RAISON_TIMEOUT_PROMPT_ID'
  ])('fails fast when %s is missing', async (name) => {
    await withTemporaryEnv({ ...startupEnv, [name]: undefined }, async () => {
      expect(() => runBackendStartupPreflight()).toThrow(
        new RegExp(`${name} is required`)
      )
    })
  })
})

