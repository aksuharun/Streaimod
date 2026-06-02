import { type Express, Router } from 'express'

import { listModerationCatalogEntries } from '../services/moderation-catalog-service.js'

const router = Router()

router.get('/', (_request, response) => {
  response.json(listModerationCatalogEntries())
})

export function registerModerationCatalogRoutes(app: Express): void {
  app.use('/api/moderation-catalog', router)
}
