import { Component } from '@geajs/core'
import { Button, Dialog } from '@geajs/ui'
import authStore from '../stores/auth-store'
import qnaStore from '../stores/qna-store'
import channelStore from '../stores/channel-store'
import QnaForm from '../components/QnaForm'
import { showErrorToast, showSuccessToast } from '../services/toast'

export default class QnaManager extends Component {
  searchQuery = ''
  isFormOpen = false
  formEntry: any = null
  lastLoadedChannel = ''
  entries: any[] = qnaStore.entries || []
  loading = qnaStore.loading
  error: string | null = qnaStore.error
  activeChannel = channelStore.activeChannelMeta
  togglingIds: Record<string, boolean> = {}
  deletingIds: Record<string, boolean> = {}
  qnaEnabled = channelStore.activeChannelMeta?.qnaEnabled ?? true
  agentToggleLoading = false
  removeChannelObservers: Array<() => void> = []
  removeAuthObservers: Array<() => void> = []
  removeQnaObservers: Array<() => void> = []
  handleSearchInput = (e: any) => {
    this.searchQuery = e.target.value
  }
  handleOpenCreate!: () => void
  handleOpenEdit!: (entry: any) => void
  handleFormSave!: () => void
  handleFormCancel!: () => void
  handleToggleEnabled!: (id: string, question: string, enabled: boolean) => Promise<void>
  handleAgentToggle!: (enabled: boolean) => Promise<void>
  handleDelete!: (id: string, question: string) => Promise<void>
  handleDialogToggle!: (d: any) => void

  constructor() {
    super()
    this.handleOpenCreate = this._handleOpenCreate.bind(this)
    this.handleOpenEdit = this._handleOpenEdit.bind(this)
    this.handleFormSave = this._handleFormSave.bind(this)
    this.handleFormCancel = this._handleFormCancel.bind(this)
    this.handleToggleEnabled = this._handleToggleEnabled.bind(this)
    this.handleAgentToggle = this._handleAgentToggle.bind(this)
    this.handleDelete = this._handleDelete.bind(this)
    this.handleDialogToggle = this._handleDialogToggle.bind(this)
  }

  created() {
    this.syncListState()
    this.syncAgentState()
    this.removeChannelObservers = [
      channelStore.observe('activeChannel', () => {
        this.syncListState()
        this.syncAgentState()
      }),
      channelStore.observe('channels', () => {
        this.syncListState()
        this.syncAgentState()
      })
    ]
    this.removeAuthObservers = [
      authStore.observe('channelSettingsUpdating', () => {
        this.syncAgentState()
      })
    ]
    this.removeQnaObservers = [
      qnaStore.observe('entries', () => this.syncListState()),
      qnaStore.observe('loading', () => this.syncListState()),
      qnaStore.observe('error', () => this.syncListState())
    ]

    const active = channelStore.activeChannel
    if (active) {
      this.lastLoadedChannel = active
      if (qnaStore.loadedChannelId !== active || qnaStore.entries.length === 0) {
        qnaStore.loadEntries(active)
      }
    }
  }

  dispose() {
    for (const removeObserver of this.removeChannelObservers) {
      removeObserver()
    }
    for (const removeObserver of this.removeAuthObservers) {
      removeObserver()
    }
    for (const removeObserver of this.removeQnaObservers) {
      removeObserver()
    }
    super.dispose()
  }

  syncListState() {
    this.entries = qnaStore.entries || []
    this.loading = qnaStore.loading
    this.error = qnaStore.error
    this.activeChannel = channelStore.activeChannelMeta
  }

  syncAgentState() {
    const activeChannel = channelStore.activeChannelMeta
    this.activeChannel = activeChannel
    this.qnaEnabled = activeChannel?.qnaEnabled ?? true
    this.agentToggleLoading = activeChannel
      ? !!authStore.channelSettingsUpdating[activeChannel.id]
      : false
  }

  loadEntriesIfNeeded() {
    const active = channelStore.activeChannel
    if (active && active !== this.lastLoadedChannel) {
      this.lastLoadedChannel = active
      qnaStore.loadEntries(active)
    }
  }

  _handleOpenCreate() {
    this.formEntry = null
    this.isFormOpen = true
  }

  _handleOpenEdit(entry: any) {
    this.formEntry = entry
    this.isFormOpen = true
  }

  _handleFormSave() {
    this.isFormOpen = false
    this.formEntry = null
    const active = channelStore.activeChannel
    if (active) qnaStore.loadEntries(active)
  }

  _handleFormCancel() {
    this.isFormOpen = false
    this.formEntry = null
  }

  _handleDialogToggle(d: any) {
    this.isFormOpen = d.open
    if (!d.open) {
      this.formEntry = null
    }
  }

  async _handleToggleEnabled(id: string, question: string, enabled: boolean) {
    if (this.togglingIds[id]) return
    this.togglingIds = { ...this.togglingIds, [id]: true }
    try {
      await qnaStore.toggleEnabled(id, enabled)
      showSuccessToast({ title: enabled ? 'Rule Activated' : 'Rule Paused', description: `"${question.substring(0, 30)}" has been ${enabled ? 'enabled' : 'disabled'}.` })
    } catch (err: any) {
      showErrorToast({ title: 'Toggle Failed', description: err.message || 'Failed to update rule status.' })
    } finally {
      const next = { ...this.togglingIds }
      delete next[id]
      this.togglingIds = next
    }
  }

  async _handleAgentToggle(enabled: boolean) {
    const activeChannel = channelStore.activeChannel
    if (!activeChannel || authStore.channelSettingsUpdating[activeChannel]) return

    try {
      this.qnaEnabled = enabled
      const session = await authStore.updateChannelSettings(activeChannel, { qnaEnabled: enabled })
      if (!session) return

      showSuccessToast({
        title: enabled ? 'Q&A Agent Enabled' : 'Q&A Agent Paused',
        description: enabled
          ? 'Saved Q&A rules will reply to matching live chat messages again.'
          : 'Saved Q&A rules remain editable, but automatic replies are paused for this channel.'
      })
    } catch (err: any) {
      this.syncAgentState()
      showErrorToast({
        title: 'Agent Update Failed',
        description: err.message || 'Failed to update the Q&A agent setting.'
      })
    }
  }

  async _handleDelete(id: string, question: string) {
    if (this.deletingIds[id]) return
    if (!confirm(`Delete Q&A rule "${question.substring(0, 40)}"?`)) return
    this.deletingIds = { ...this.deletingIds, [id]: true }
    try {
      await qnaStore.deleteEntry(id)
      showSuccessToast({ title: 'Rule Deleted', description: 'The Q&A response rule has been permanently removed.' })
    } catch (err: any) {
      showErrorToast({ title: 'Delete Failed', description: err.message || 'Failed to delete the rule.' })
    } finally {
      this.deletingIds = { ...this.deletingIds, [id]: false }
    }
  }

  get qnaToggleLabel() {
    if (this.agentToggleLoading) return 'Saving'
    return this.qnaEnabled ? 'Enabled' : 'Paused'
  }

  template() {
    this.loadEntriesIfNeeded()

    const entries = this.entries
    const loading = this.loading
    const error = this.error
    const search = this.searchQuery.toLowerCase()
    const filteredEntries = search ? entries.filter((entry: any) => {
      return (entry.question?.toLowerCase() || '').includes(search) || (entry.answer?.toLowerCase() || '').includes(search)
    }) : entries

    return (
      <div class="space-y-6 max-w-6xl w-full mx-auto px-4 py-6">
        <div class="page-header">
          <div>
            <p class="page-kicker">Automated replies</p>
            <h1 class="page-title">Q&A Rules</h1>
            <p class="page-description">Create answers for repeated live chat questions. The bot only replies when a configured match exists.</p>
          </div>
          {entries.length > 0 && (
            <div class="flex items-center gap-3">
              <Button click={this.handleOpenCreate}>Add Response Rule</Button>
            </div>
          )}
        </div>

        {this.activeChannel && (
          <section class="rounded-xl border border-slate-800/70 bg-slate-950/30 px-5 py-4 backdrop-blur-md">
            <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p class="text-sm font-semibold text-slate-100">Q&A agent status</p>
                <p class="mt-1 text-sm text-slate-400">
                  {this.qnaEnabled
                    ? 'The live Q&A agent is enabled and can answer matching viewer questions.'
                    : 'The live Q&A agent is paused. Your saved rules stay intact, but automatic replies are paused for this channel.'}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={this.qnaEnabled}
                aria-label={this.qnaToggleLabel}
                disabled={this.agentToggleLoading}
                click={() => {
                  if (!this.agentToggleLoading) {
                    this.handleAgentToggle(!this.qnaEnabled)
                  }
                }}
                class={`status-toggle ${this.qnaEnabled ? 'status-toggle-on' : 'status-toggle-off'} ${this.agentToggleLoading ? 'status-toggle-disabled' : ''}`}
              >
                <span class={`status-toggle-track ${this.qnaEnabled ? 'status-toggle-track-on' : 'status-toggle-track-off'}`}>
                  <span class={`status-toggle-thumb ${this.qnaEnabled ? 'status-toggle-thumb-on' : 'status-toggle-thumb-off'}`}></span>
                </span>
                <span class="status-toggle-label">{this.qnaToggleLabel}</span>
              </button>
            </div>
          </section>
        )}

        {this.error && (
          <div class="p-4 border border-rose-500/20 bg-rose-500/5 text-rose-400 text-sm rounded-lg flex items-center justify-between">
            <span><strong>Error:</strong> {this.error}</span>
            <Button size="sm" variant="ghost" class="text-rose-400 hover:bg-rose-500/10" click={() => qnaStore.loadEntries(channelStore.activeChannel)}>Retry</Button>
          </div>
        )}

        {this.loading && entries.length === 0 && (
          <div class="flex flex-col items-center justify-center py-20 space-y-4">
            <div class="w-10 h-10 border-4 border-teal-500/30 border-t-teal-500 rounded-full animate-spin"></div>
            <p class="text-slate-400 text-sm">Retrieving your automated answers...</p>
          </div>
        )}

        {!loading && !error && entries.length === 0 && (
          <div class="max-w-xl mx-auto py-8 text-center">
            <div class="mx-auto w-16 h-16 rounded-full bg-teal-500/10 flex items-center justify-center mb-4 text-teal-400 border border-teal-500/20">
              <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            </div>
            <h3 class="text-lg font-bold text-slate-200 mb-2">Initialize automated responses</h3>
            <p class="text-sm text-slate-400 mb-6">This channel has no automated Q&A response rules configured yet.</p>
            <Button click={this.handleOpenCreate} class="bg-teal-500 hover:bg-teal-600 text-slate-950 font-bold">Add First Rule</Button>
          </div>
        )}

        {!loading && entries.length > 0 && (
          <div class="space-y-4">
            <div class="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <div class="relative max-w-sm w-full">
                <input
                  type="text"
                  placeholder="Filter by question or answer keywords..."
                  value={this.searchQuery}
                  input={this.handleSearchInput}
                  class="flex h-9 w-full rounded-lg border border-slate-800 bg-slate-900/60 pl-9 pr-4 py-2 text-sm text-slate-100 shadow-xs transition-colors placeholder:text-slate-500 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-teal-500/50"
                />
                <div class="absolute left-3 top-2.5 text-slate-550 pointer-events-none">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                </div>
              </div>
              <span class="text-xs text-slate-500 font-mono self-end sm:self-center select-none">Filtered: <strong class="text-teal-400 font-bold">{filteredEntries.length}</strong> / {entries.length} rules</span>
            </div>

            {filteredEntries.length === 0 && (
              <div class="text-center py-12 border border-dashed border-slate-800 rounded-xl bg-slate-950/20 backdrop-blur-sm"><p class="text-slate-400 text-sm">No Q&A rules match your search query.</p></div>
            )}

            {filteredEntries.length > 0 && (
              <div class="overflow-x-auto border border-slate-800/60 rounded-xl bg-slate-950/30 backdrop-blur-md shadow-2xl">
                <table class="w-full text-left border-collapse min-w-[640px]">
                  <thead>
                    <tr class="border-b border-slate-850 bg-slate-900/40 text-slate-400 text-xs font-bold uppercase tracking-wider select-none">
                      <th class="py-4 px-5 min-w-[200px]">Question / Keyword Match</th>
                      <th class="py-4 px-5 min-w-[280px]">Automated Answer</th>
                      <th class="py-4 px-5 text-center w-[120px]">Status</th>
                      <th class="py-4 px-5 text-right w-[160px]">Actions</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-850">
                    {filteredEntries.map((entry: any) => (
                      <tr key={entry.id} class="hover:bg-slate-900/30 transition-all duration-200 align-middle text-sm text-slate-100">
                        <td class="py-4.5 px-5 font-semibold leading-normal pr-4"><div class="max-w-[240px] truncate" title={entry.question}>{entry.question}</div></td>
                        <td class="py-4.5 px-5 text-slate-300 leading-relaxed pr-4 font-normal"><div class="max-w-[320px] truncate" title={entry.answer}>{entry.answer}</div></td>
                        <td class="py-4.5 px-5 text-center whitespace-nowrap">
                          <div class="inline-flex justify-center items-center">
                            <button
                              type="button"
                              role="switch"
                              aria-checked={entry.enabled}
                              aria-label={entry.enabled ? 'Active' : 'Paused'}
                              disabled={!!this.togglingIds[entry.id]}
                              click={() => {
                                if (!this.togglingIds[entry.id]) {
                                  this.handleToggleEnabled(entry.id, entry.question, !entry.enabled)
                                }
                              }}
                              class={`status-toggle ${entry.enabled ? 'status-toggle-on' : 'status-toggle-off'} ${this.togglingIds[entry.id] ? 'status-toggle-disabled' : ''}`}
                            >
                              <span class={`status-toggle-track ${entry.enabled ? 'status-toggle-track-on' : 'status-toggle-track-off'}`}>
                                <span class={`status-toggle-thumb ${entry.enabled ? 'status-toggle-thumb-on' : 'status-toggle-thumb-off'}`}></span>
                              </span>
                              <span class="status-toggle-label">{entry.enabled ? 'Active' : 'Paused'}</span>
                            </button>
                          </div>
                        </td>
                        <td class="py-4.5 px-5 text-right whitespace-nowrap">
                          <div class="inline-flex gap-2">
                            <Button variant="outline" size="sm" click={() => this.handleOpenEdit(entry)} class="px-3.5 py-1.5 text-xs text-slate-300 hover:text-white hover:border-teal-500/40 border-slate-800 bg-slate-950/40 hover:bg-slate-900 transition-all duration-200">Edit</Button>
                            <Button variant="destructive" size="sm" disabled={this.deletingIds[entry.id]} click={() => this.handleDelete(entry.id, entry.question)} class="px-3.5 py-1.5 text-xs font-semibold shadow-sm hover:shadow-[0_0_10px_rgba(239,68,68,0.2)] transition-all duration-200">{this.deletingIds[entry.id] ? 'Deleting...' : 'Delete'}</Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {this.isFormOpen && (
          <Dialog title={this.formEntry ? 'Modify Q&A Rule' : 'Add Q&A Response Rule'} description={this.formEntry ? 'Update trigger matching phrase or automated answer.' : 'Create an automated response for your channel live chat.'} defaultOpen={true} onOpenChange={this.handleDialogToggle} class="max-w-xl">
            <QnaForm entry={this.formEntry} onSave={this.handleFormSave} onCancel={this.handleFormCancel} />
          </Dialog>
        )}
      </div>
    )
  }
}
