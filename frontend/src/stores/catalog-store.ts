import { Store } from '@geajs/core'
import { api, type CatalogEntry } from '../services/api'

class CatalogStore extends Store {
  entries: CatalogEntry[] = []
  loading = false
  error: string | null = null
  loaded = false

  async loadCatalog(force = false) {
    if (this.loaded && !force) {
      return
    }

    this.loading = true
    this.error = null

    try {
      const result = await api.getCatalogEntries()
      this.entries = result
      this.loaded = true
    } catch (err: any) {
      this.error = err.message || 'Failed to load moderation catalog'
      console.error(err)
    } finally {
      this.loading = false
    }
  }
}

const catalogStore = new CatalogStore()
export default catalogStore
