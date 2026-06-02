/**
 * Standalone stub backend for Playwright full-stack smoke tests.
 *
 * Starts an Express server on port 3000 that:
 * - Exercises the REAL YouTube channel route code (route → service → YouTube API shape)
 * - Stubs external YouTube API calls at the fetch boundary (no real API keys needed)
 * - Provides /health for Playwright webServer readiness probing
 * - Returns empty stubs for other dashboard APIs that the frontend calls
 *
 * Usage: npx tsx tests/helpers/run-stub-backend.ts
 * (run from the backend/ directory)
 */

import express from 'express'
import { type Server } from 'node:http'

// ---------------------------------------------------------------------------
// 1. Set up environment before importing routes
// ---------------------------------------------------------------------------

process.env.YOUTUBE_API_KEY = 'playwright-stub-api-key'

// ---------------------------------------------------------------------------
// 2. Stub global fetch so the real YouTube service never hits the internet
// ---------------------------------------------------------------------------

function createStubFetch(): typeof globalThis.fetch {
  const stub = async (input: Parameters<typeof globalThis.fetch>[0], _init?: RequestInit): Promise<Response> => {
    const urlString = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

    if (!urlString.includes('googleapis.com/youtube')) {
      // Should not happen in this stub — fail loudly so the test catches misconfiguration
      return new Response(JSON.stringify({ error: `Unexpected fetch URL: ${urlString}` }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // -- channels.list (resolve by handle or ID) --
    if (urlString.includes('/youtube/v3/channels')) {
      return new Response(
        JSON.stringify({
          items: [
            {
              id: 'UCX6OQ3DkcsbYNE6H8uQQuVA',
              snippet: {
                title: 'MrBeast',
                customUrl: 'MrBeast',
                thumbnails: {
                  high: { url: 'https://example.com/mrbeast-thumb.jpg' },
                },
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }

    // -- search.list (count live & upcoming streams) --
    if (urlString.includes('/youtube/v3/search')) {
      const searchUrl = new URL(urlString)
      const eventType = searchUrl.searchParams.get('eventType')
      const totalResults = eventType === 'live' ? 2 : eventType === 'upcoming' ? 1 : 0

      return new Response(
        JSON.stringify({ pageInfo: { totalResults } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }

    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return stub as typeof globalThis.fetch
}

globalThis.fetch = createStubFetch()

// ---------------------------------------------------------------------------
// 3. Create the Express application
// ---------------------------------------------------------------------------

function createServer(): express.Express {
  const app = express()

  app.disable('x-powered-by')
  app.use(express.json({ limit: '1mb' }))
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', 'http://localhost:5173')
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS')

    if (req.method === 'OPTIONS') {
      res.sendStatus(204)
      return
    }

    next()
  })

  // -- health check (used by Playwright webServer readiness probe) --
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  // -- stream status (fires on dashboard load) --
  app.get('/api/stream/status', (_req, res) => {
    res.json({
      active: false,
      channelId: 'UCAuthenticatedChannel',
      streamId: null,
      startedAt: null,
    })
  })

  app.post('/api/stream/start', (_req, res) => {
    res.json({
      active: true,
      channelId: 'UCAuthenticatedChannel',
      streamId: 'stub-live-stream',
      startedAt: new Date().toISOString(),
    })
  })

  app.post('/api/stream/stop', (_req, res) => {
    res.json({
      active: false,
      channelId: 'UCAuthenticatedChannel',
      streamId: null,
      startedAt: null,
    })
  })

  app.get('/api/streams', (_req, res) => {
    res.json({
      active: [
        {
          id: 'stub-live-stream',
          platform: 'youtube',
          title: 'Stub live stream',
          status: 'live',
          viewerCount: 128,
          startsAt: new Date(Date.now() - 3_600_000).toISOString(),
          fetchedAt: new Date().toISOString(),
        },
      ],
      scheduled: [],
      fetchedAt: new Date().toISOString(),
    })
  })

  // -- moderation catalog (fires on dashboard load) --
  app.get('/api/moderation-catalog', (_req, res) => {
    res.json([])
  })

  // -- Error handler --
  app.use(
    (
      err: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      console.error('[stub-backend] error:', err.message)
      res.status(500).json({ error: 'Internal server error' })
    },
  )

  return app
}

// ---------------------------------------------------------------------------
// 4. Start listening
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.STUB_PORT || '3000', 10)
const server: Server = createServer().listen(PORT, () => {
  console.log(`[stub-backend] listening on http://localhost:${PORT}`)
})

// Graceful shutdown so Playwright webServer management can tear us down cleanly
function shutdown(signal: string) {
  console.log(`[stub-backend] received ${signal}; shutting down`)
  server.close(() => process.exit(0))
}

process.once('SIGINT', () => shutdown('SIGINT'))
process.once('SIGTERM', () => shutdown('SIGTERM'))
