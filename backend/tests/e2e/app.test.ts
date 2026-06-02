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

  it('rejects malformed JSON payloads', async () => {
    const response = await request(createTestApp())
      .post('/health')
      .set('content-type', 'application/json')
      .send('{"broken"')
      .expect(400)

    expect(response.body).toEqual({ error: 'Invalid JSON payload' })
  })
})
