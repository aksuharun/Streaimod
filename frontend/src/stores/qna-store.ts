import { Store } from '@geajs/core'
import { api, type QnaEntry } from '../services/api'
import channelStore from './channel-store'

class QnaStore extends Store {
  entries: QnaEntry[] = []
  loading = false
  error: string | null = null
  loadedChannelId: string | null = null

  async loadEntries(channelId: string) {
    if (!channelId) {
      this.entries = []
      this.loadedChannelId = null
      return
    }

    const keepExistingEntries =
      this.loadedChannelId === channelId && this.entries.length > 0

    this.loadedChannelId = channelId
    if (!keepExistingEntries) {
      this.entries = []
    }
    this.error = null
    this.loading = true

    try {
      const result = await api.getQnaEntries(channelId)
      if (channelStore.activeChannel === channelId) {
        this.entries = result
      }
    } catch (err: any) {
      if (channelStore.activeChannel === channelId) {
        this.error = err.message || 'Failed to load Q&A entries'
      }
      console.error(err)
    } finally {
      if (this.loadedChannelId === channelId) {
        this.loading = false
      }
    }
  }

  async fetchEntries(channelId: string) {
    return this.loadEntries(channelId)
  }

  async addEntry(question: string, answer: string, enabled = true) {
    const channelId = channelStore.activeChannel
    if (!channelId) {
      throw new Error('No active channel selected')
    }

    this.loading = true
    this.error = null

    try {
      const newEntry = await api.createQnaEntry({
        channelId,
        question,
        answer,
        enabled
      })
      this.entries = [...this.entries, newEntry]
      return newEntry
    } catch (err: any) {
      this.error = err.message || 'Failed to add Q&A entry'
      throw err;
    } finally {
      this.loading = false
    }
  }

  async updateEntry(id: string, data: { question?: string; answer?: string; enabled?: boolean }) {
    this.loading = true
    this.error = null

    try {
      const updated = await api.updateQnaEntry(id, data)
      this.entries = this.entries.map((entry) =>
        entry.id === id ? updated : entry
      )
      return updated
    } catch (err: any) {
      this.error = err.message || 'Failed to update Q&A entry'
      throw err;
    } finally {
      this.loading = false
    }
  }

  async deleteEntry(id: string) {
    this.loading = true
    this.error = null

    try {
      await api.deleteQnaEntry(id)
      this.entries = this.entries.filter(e => e.id !== id)
    } catch (err: any) {
      this.error = err.message || 'Failed to delete Q&A entry'
      throw err;
    } finally {
      this.loading = false
    }
  }

  async toggleEnabled(id: string, enabled: boolean) {
    return this.updateEntry(id, { enabled })
  }
}

const qnaStore = new QnaStore()
export default qnaStore
