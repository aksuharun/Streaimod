import { Store } from '@geajs/core'
import { api, type ModerationCategory, type ModerationCategoryType, type CatalogEntry } from '../services/api'
import channelStore from './channel-store'
import catalogStore from './catalog-store'

class CategoryStore extends Store {
  categories: ModerationCategory[] = []
  catalog: CatalogEntry[] = []
  loading = false
  error: string | null = null
  loadedChannelId: string | null = null

  async fetchCatalog() {
    this.loading = true
    this.error = null
    try {
      await catalogStore.loadCatalog()
      this.catalog = catalogStore.entries
    } catch (err: any) {
      this.error = err.message || 'Failed to load moderation catalog'
      console.error(err)
    } finally {
      this.loading = false
    }
  }

  async loadCategories(channelId: string) {
    if (!channelId) {
      this.categories = []
      this.error = null
      this.loadedChannelId = null
      return
    }

    const keepExistingCategories =
      this.loadedChannelId === channelId && this.categories.length > 0

    this.loadedChannelId = channelId
    if (!keepExistingCategories) {
      this.categories = []
    }
    this.error = null
    this.loading = true

    try {
      const result = await api.getCategories({ channelId })
      if (channelStore.activeChannel === channelId) {
        this.categories = result
        this.error = null
      }
    } catch (err: any) {
      if (channelStore.activeChannel === channelId) {
        this.error = err.message || 'Failed to load moderation categories'
      }
      console.error(err)
    } finally {
      if (this.loadedChannelId === channelId) {
        this.loading = false
      }
    }
  }

  async fetchCategories(channelId: string) {
    return this.loadCategories(channelId)
  }

  async addCategory(catalogId: string, type: ModerationCategoryType, label: string, definition: string, enabled = true) {
    const channelId = channelStore.activeChannel
    if (!channelId) {
      throw new Error('No active channel selected')
    }

    this.loading = true
    this.error = null

    try {
      const newCategory = await api.createCategory({
        channelId,
        catalogId,
        type,
        label,
        definition,
        enabled
      })
      this.categories = [...this.categories, newCategory]
      return newCategory
    } catch (err: any) {
      this.error = err.message || 'Failed to add category'
      throw err
    } finally {
      this.loading = false
    }
  }

  async createCategory(categoryData: {
    channelId: string
    catalogId: string
    type: ModerationCategoryType
    label: string
    definition: string
    enabled?: boolean
  }) {
    return this.addCategory(
      categoryData.catalogId,
      categoryData.type,
      categoryData.label,
      categoryData.definition,
      categoryData.enabled !== undefined ? categoryData.enabled : true
    )
  }

  async updateCategory(
    id: string,
    data: {
      catalogId?: string
      type?: ModerationCategoryType
      label?: string
      definition?: string
      enabled?: boolean
    }
  ) {
    this.loading = true
    this.error = null

    try {
      const updated = await api.updateCategory(id, data)
      this.categories = this.categories.map(category => category.id === id ? updated : category)
      return updated
    } catch (err: any) {
      this.error = err.message || 'Failed to update category'
      throw err
    } finally {
      this.loading = false
    }
  }

  async deleteCategory(id: string) {
    this.loading = true
    this.error = null

    try {
      await api.deleteCategory(id)
      this.categories = this.categories.filter(c => c.id !== id)
    } catch (err: any) {
      this.error = err.message || 'Failed to delete category'
      throw err
    } finally {
      this.loading = false
    }
  }

  async toggleEnabled(id: string, enabled: boolean) {
    return this.updateCategory(id, { enabled })
  }

  async changeType(id: string, type: ModerationCategoryType) {
    return this.updateCategory(id, { type })
  }

  async bootstrap(
    channelIdOrPayload: string | Array<{ catalogId: string; type: ModerationCategoryType; enabled?: boolean }>,
    maybePayload?: Array<{ catalogId: string; type: ModerationCategoryType; enabled?: boolean }>
  ) {
    let channelId = channelStore.activeChannel
    let payload: Array<{ catalogId: string; type: ModerationCategoryType; enabled?: boolean }>

    if (typeof channelIdOrPayload === 'string') {
      channelId = channelIdOrPayload
      payload = maybePayload!
    } else {
      payload = channelIdOrPayload
    }

    if (!channelId) {
      throw new Error('No active channel selected')
    }

    this.loading = true
    this.error = null

    try {
      const response = await api.bootstrapCategories({
        channelId,
        categories: payload
      })
      // Reload categories to ensure we have the fresh full list
      await this.loadCategories(channelId)
      return response
    } catch (err: any) {
      this.error = err.message || 'Failed to bootstrap categories'
      throw err
    } finally {
      this.loading = false
    }
  }
}

const categoryStore = new CategoryStore()
export default categoryStore
