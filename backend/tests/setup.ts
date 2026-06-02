import { afterAll, afterEach, vi } from 'vitest'

import { setupTestDatabase, teardownTestDatabase } from './helpers/test-database.js'

vi.mock('mongoose', async () => {
  const memgoose = await import('memgoose')

  return {
    ...memgoose,
    default: memgoose.default
  }
})

process.env.NODE_ENV = 'test'

setupTestDatabase()

afterAll(async () => {
  await teardownTestDatabase()
})

afterEach(() => {
  vi.clearAllMocks()
})
