import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib'

import request from 'supertest'

import { createTestApp } from '../helpers/test-app.js'

describe('app shell', () => {
  it('responds to health checks without exposing Express internals', async () => {
    const response = await request(createTestApp()).get('/health').expect(200)

    expect(response.body).toEqual({ status: 'ok' })
    expect(response.headers['x-powered-by']).toBeUndefined()
  })

  it('returns JSON for unknown routes', async () => {
    const response = await request(createTestApp()).get('/missing-route').expect(404)

    expect(response.body).toEqual({ error: 'Not found' })
  })

  it.each([
    ['br', brotliCompressSync],
    ['gzip', gzipSync],
    ['deflate', deflateSync]
  ] as const)('rejects %s JSON bodies before routing', async (encoding, compress) => {
    const response = await request(createTestApp())
      .post('/api/auth/active-channel')
      .set('content-type', 'application/json')
      .set('content-encoding', encoding)
      .send(compress(Buffer.from(JSON.stringify({ channelId: 'test-channel' }))))
      .expect(415)

    expect(response.body).toEqual({ error: 'Compressed request bodies are not supported' })
  })

  it.each([undefined, 'identity'])('accepts plain JSON with encoding %s', async (encoding) => {
    const app = createTestApp((app) => {
      app.post('/test-json', (req, res) => res.json(req.body))
    })
    const body = { message: 'Plain JSON is still supported' }
    const pendingRequest = request(app).post('/test-json')

    if (encoding) {
      pendingRequest.set('content-encoding', encoding)
    }

    const response = await pendingRequest.send(body).expect(200)
    expect(response.body).toEqual(body)
  })

  it('rejects malformed JSON payloads', async () => {
    const response = await request(createTestApp())
      .post('/health')
      .set('content-type', 'application/json')
      .send('{"broken"')
      .expect(400)

    expect(response.body).toEqual({ error: 'Invalid JSON payload' })
  })
})
