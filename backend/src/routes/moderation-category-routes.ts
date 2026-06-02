import { type Express, Router } from 'express'

import {
  getAuthenticatedUser,
  requireAuthenticatedUser,
  resolveOwnedChannelId
} from '../middleware/auth.js'
import type {
  IModerationCategoryDocument,
  ModerationCategoryType
} from '../models/moderation-category.js'
import { userOwnsChannel } from '../services/google-auth-service.js'
import {
  bootstrapCategories,
  createCategory,
  deleteCategory,
  getCategory,
  isValidType,
  listCategories,
  ModerationCategoryServiceError,
  updateCategory
} from '../services/moderation-category-service.js'

const router = Router()

router.use(requireAuthenticatedUser)

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function toCategoryDto(doc: IModerationCategoryDocument) {
  return {
    id: String(doc._id),
    channelId: doc.channelId,
    catalogId: doc.catalogId,
    type: doc.type,
    label: doc.label,
    definition: doc.definition,
    enabled: doc.enabled,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  }
}

router.post('/', async (request_, response, next) => {
  try {
    const body = request_.body as Record<string, unknown> | undefined

    if (!body || typeof body !== 'object') {
      response.status(400).json({ error: 'Request body is required' })
      return
    }

    const channelId = resolveOwnedChannelId(request_, response, body.channelId)

    if (!channelId) {
      return
    }

    const { catalogId, type, label, definition } = body

    if (!isNonEmptyString(catalogId)) {
      response
        .status(400)
        .json({ error: 'catalogId is required and must be a non-empty string' })
      return
    }

    if (typeof type !== 'string' || !isValidType(type)) {
      response.status(400).json({ error: 'type is required and must be "ban" or "timeout"' })
      return
    }

    if (!isNonEmptyString(label)) {
      response
        .status(400)
        .json({ error: 'label is required and must be a non-empty string' })
      return
    }

    if (!isNonEmptyString(definition)) {
      response
        .status(400)
        .json({ error: 'definition is required and must be a non-empty string' })
      return
    }

    if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
      response.status(400).json({ error: 'enabled must be a boolean' })
      return
    }

    const category = await createCategory({
      channelId,
      catalogId,
      type: type as ModerationCategoryType,
      label,
      definition,
      enabled: body.enabled
    })

    response.status(201).json(toCategoryDto(category))
  } catch (error) {
    if (error instanceof ModerationCategoryServiceError) {
      if (error.code === 'NORMALIZED_EMPTY' || error.code === 'INVALID_CATALOG_ID') {
        response.status(400).json({ error: error.message })
        return
      }
      if (
        error.code === 'DUPLICATE_CATEGORY' ||
        error.code === 'DUPLICATE_CATALOG_CATEGORY'
      ) {
        response.status(409).json({ error: error.message })
        return
      }
    }
    next(error)
  }
})

router.get('/', async (request_, response, next) => {
  try {
    const query = request_.query as Record<string, unknown>

    if (
      Object.keys(query).some(
        (key) => key === 'channelId[]' || key.startsWith('channelId[')
      )
    ) {
      response.status(400).json({ error: 'channelId must be a non-empty string' })
      return
    }

    const channelIdParam = request_.query.channelId

    if (channelIdParam !== undefined && typeof channelIdParam !== 'string') {
      response.status(400).json({ error: 'channelId must be a non-empty string' })
      return
    }

    const channelId = resolveOwnedChannelId(
      request_,
      response,
      channelIdParam,
      { fallbackToActiveChannel: true }
    )

    if (!channelId) {
      return
    }

    if (Object.keys(query).some((key) => key === 'type[]' || key.startsWith('type['))) {
      response.status(400).json({ error: 'type must be "ban" or "timeout"' })
      return
    }

    const typeParam = request_.query.type
    let type: ModerationCategoryType | undefined

    if (typeParam !== undefined) {
      if (typeof typeParam !== 'string' || !isValidType(typeParam)) {
        response.status(400).json({ error: 'type must be "ban" or "timeout"' })
        return
      }

      type = typeParam as ModerationCategoryType
    }

    const categories = await listCategories({
      channelId: channelId === '*' ? undefined : channelId,
      type
    })

    response.json(categories.map(toCategoryDto))
  } catch (error) {
    next(error)
  }
})

router.post('/bootstrap', async (request_, response, next) => {
  try {
    const body = request_.body as Record<string, unknown> | undefined

    if (!body || typeof body !== 'object') {
      response.status(400).json({ error: 'Request body is required' })
      return
    }

    const channelId = resolveOwnedChannelId(request_, response, body.channelId)

    if (!channelId) {
      return
    }

    const { categories } = body

    if (!Array.isArray(categories) || categories.length === 0) {
      response
        .status(400)
        .json({ error: 'categories must be a non-empty array' })
      return
    }

    for (let i = 0; i < categories.length; i++) {
      const cat = categories[i] as Record<string, unknown> | undefined

      if (!cat || typeof cat !== 'object') {
        response
          .status(400)
          .json({ error: `categories[${i}] must be an object` })
        return
      }

      if (!isNonEmptyString(cat.catalogId)) {
        response
          .status(400)
          .json({
            error: `categories[${i}].catalogId must be a non-empty string`
          })
        return
      }

      if (typeof cat.type !== 'string' || !isValidType(cat.type)) {
        response
          .status(400)
          .json({ error: `categories[${i}].type must be "ban" or "timeout"` })
        return
      }

      if (cat.enabled !== undefined && typeof cat.enabled !== 'boolean') {
        response
          .status(400)
          .json({ error: `categories[${i}].enabled must be a boolean` })
        return
      }
    }

    const normalizedCategories = categories.map((cat) => {
      const c = cat as Record<string, unknown>
      return {
        catalogId: c.catalogId as string,
        type: c.type as ModerationCategoryType,
        enabled: c.enabled !== undefined ? Boolean(c.enabled) : true
      }
    })

    const result = await bootstrapCategories({
      channelId: channelId as string,
      categories: normalizedCategories
    })

    const statusCode = result.createdCount > 0 ? 201 : 200

    response.status(statusCode).json({
      channelId: result.channelId,
      createdCount: result.createdCount,
      skippedCount: result.skippedCount,
      categories: result.categories.map(toCategoryDto)
    })
  } catch (error) {
    if (error instanceof ModerationCategoryServiceError) {
      if (
        error.code === 'DUPLICATE_CATEGORY' ||
        error.code === 'DUPLICATE_CATALOG_CATEGORY'
      ) {
        response.status(409).json({ error: error.message })
        return
      }

      response.status(400).json({ error: error.message })
      return
    }
    next(error)
  }
})

router.get('/:id', async (request_, response, next) => {
  try {
    const category = await getCategory(request_.params.id)

    if (!category || !userOwnsChannel(getAuthenticatedUser(request_), category.channelId)) {
      response.status(404).json({ error: 'Moderation category not found' })
      return
    }

    response.json(toCategoryDto(category))
  } catch (error) {
    next(error)
  }
})

router.patch('/:id', async (request_, response, next) => {
  try {
    const body = request_.body as Record<string, unknown> | undefined

    if (!body || typeof body !== 'object') {
      response.status(400).json({ error: 'Request body is required' })
      return
    }

    const updateData: {
      catalogId?: string
      type?: ModerationCategoryType
      label?: string
      definition?: string
      enabled?: boolean
    } = {}

    if (body.catalogId !== undefined) {
      if (!isNonEmptyString(body.catalogId)) {
        response.status(400).json({ error: 'catalogId must be a non-empty string' })
        return
      }
      updateData.catalogId = body.catalogId
    }

    if (body.type !== undefined) {
      if (typeof body.type !== 'string' || !isValidType(body.type)) {
        response
          .status(400)
          .json({ error: 'type must be "ban" or "timeout"' })
        return
      }
      updateData.type = body.type as ModerationCategoryType
    }

    if (body.label !== undefined) {
      if (!isNonEmptyString(body.label)) {
        response
          .status(400)
          .json({ error: 'label must be a non-empty string' })
        return
      }
      updateData.label = body.label
    }

    if (body.definition !== undefined) {
      if (!isNonEmptyString(body.definition)) {
        response
          .status(400)
          .json({ error: 'definition must be a non-empty string' })
        return
      }
      updateData.definition = body.definition
    }

    if (body.enabled !== undefined) {
      if (typeof body.enabled !== 'boolean') {
        response.status(400).json({ error: 'enabled must be a boolean' })
        return
      }
      updateData.enabled = body.enabled
    }

    if (Object.keys(updateData).length === 0) {
      response.status(400).json({
        error:
          'At least one of catalogId, type, label, definition, or enabled must be provided'
      })
      return
    }

    const category = await updateCategory(request_.params.id, updateData)

    if (!category || !userOwnsChannel(getAuthenticatedUser(request_), category.channelId)) {
      response.status(404).json({ error: 'Moderation category not found' })
      return
    }

    response.json(toCategoryDto(category))
  } catch (error) {
    if (error instanceof ModerationCategoryServiceError) {
      if (error.code === 'NORMALIZED_EMPTY' || error.code === 'INVALID_CATALOG_ID') {
        response.status(400).json({ error: error.message })
        return
      }
      if (
        error.code === 'DUPLICATE_CATEGORY' ||
        error.code === 'DUPLICATE_CATALOG_CATEGORY'
      ) {
        response.status(409).json({ error: error.message })
        return
      }
    }
    next(error)
  }
})

router.delete('/:id', async (request_, response, next) => {
  try {
    const category = await getCategory(request_.params.id)

    if (!category || !userOwnsChannel(getAuthenticatedUser(request_), category.channelId)) {
      response.status(404).json({ error: 'Moderation category not found' })
      return
    }

    const deleted = await deleteCategory(request_.params.id)

    if (!deleted) {
      response.status(404).json({ error: 'Moderation category not found' })
      return
    }

    response.status(204).send()
  } catch (error) {
    next(error)
  }
})

export function registerModerationCategoryRoutes(app: Express): void {
  app.use('/api/moderation-categories', router)
}
