import { type Server } from 'node:http'

import mongoose from 'mongoose'

import { createApp } from './app.js'
import { getOptionalEnv, runBackendStartupPreflight } from './config/env.js'
import { seedModerationCatalog } from './services/moderation-catalog-service.js'
import { assertNoLegacyModerationCategoriesWithoutCatalogId } from './services/moderation-category-service.js'
import { stopAllManagedStreamRuntimes } from './services/stream-runtime-service.js'

const DEFAULT_PORT = 3000

function getPort(rawPort: string | undefined): number {
  if (!rawPort) {
    return DEFAULT_PORT
  }

  if (!/^\d+$/.test(rawPort)) {
    throw new Error(`Invalid PORT value: ${rawPort}`)
  }

  const parsedPort = Number(rawPort)

  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
    throw new Error(`Invalid PORT value: ${rawPort}`)
  }

  return parsedPort
}

function listen(app: ReturnType<typeof createApp>, port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      resolve(server)
    })

    server.once('error', reject)
  })
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}

function registerShutdownHandlers(
  server: Server
): void {
  let shuttingDown = false

  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      return
    }

    shuttingDown = true
    console.info(`Received ${signal}; shutting down backend runtime`)

    try {
      await stopAllManagedStreamRuntimes()
      await closeServer(server)
      await mongoose.disconnect()
      process.exit(0)
    } catch (error) {
      console.error(error)
      process.exit(1)
    }
  }

  process.once('SIGINT', () => {
    void shutdown('SIGINT')
  })

  process.once('SIGTERM', () => {
    void shutdown('SIGTERM')
  })
}

async function startServer(): Promise<void> {
  runBackendStartupPreflight()
  const mongoUri = getOptionalEnv('MONGODB_URI', 'mongodb://localhost:27017/ai-mod')

  await mongoose.connect(mongoUri)
  await seedModerationCatalog()
  await assertNoLegacyModerationCategoriesWithoutCatalogId()

  const app = createApp()
  const port = getPort(process.env.PORT)
  const server = await listen(app, port)

  console.info(`Backend listening on port ${port}`)
  registerShutdownHandlers(server)
}

startServer().catch((error: unknown) => {
  console.error(error)
  void mongoose.disconnect().catch(() => undefined)
  process.exit(1)
})
