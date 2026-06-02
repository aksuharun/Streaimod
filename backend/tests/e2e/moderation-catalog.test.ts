import request from 'supertest'

import { CANONICAL_MODERATION_CATALOG } from '../../src/services/moderation-catalog-service.js'
import { createTestApp } from '../helpers/test-app.js'

describe('Moderation Catalog API', () => {
  it('returns canonical catalog entries in canonical order', async () => {
    const response = await request(createTestApp())
      .get('/api/moderation-catalog')
      .expect(200)

    expect(response.body).toEqual(CANONICAL_MODERATION_CATALOG)
  })
})
