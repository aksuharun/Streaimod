import { connect, disconnect } from 'memgoose'

type TestModel = {
  deleteMany: (query: Record<string, never>) => Promise<unknown> | unknown
}

let connected = false
const registeredModels = new Set<TestModel>()

export function setupTestDatabase(): void {
  if (connected) {
    return
  }

  connect({ storage: 'memory' })
  connected = true
}

export function registerTestModel(model: TestModel): void {
  registeredModels.add(model)
}

export async function clearTestDatabase(): Promise<void> {
  if (!connected) {
    setupTestDatabase()
  }

  await Promise.all(
    Array.from(registeredModels).map(async (model) => {
      await model.deleteMany({})
    })
  )
}

export async function teardownTestDatabase(): Promise<void> {
  if (!connected) {
    return
  }

  await disconnect()
  connected = false
}
