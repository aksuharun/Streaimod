import { Component } from '@geajs/core'
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@geajs/ui'
import authStore from '../stores/auth-store'
import categoryStore from '../stores/category-store'
import appStore from '../stores/channel-store'
import type { ModerationCategoryType } from '../services/api'
import { showErrorToast, showSuccessToast } from '../services/toast'

type BoardColumnType = 'catalog' | ModerationCategoryType

interface BoardItem {
  catalogId: string
  categoryId: string | null
  label: string
  definition: string
  type: ModerationCategoryType | null
  enabled: boolean
}

interface AgentColumnProps {
  manager: ModerationManager
  column: BoardColumnType
  title: string
  description: string
  accentClass: string
  badgeLabel: string
  items: BoardItem[]
}

class AgentColumn extends Component {
  template() {
    const props = this.props as AgentColumnProps
    const isActiveDropTarget = props.manager.dragOverColumn === props.column

    return (
      <section
        class={`flex min-h-[32rem] flex-col rounded-[1.25rem] border bg-card/70 shadow-[0_18px_50px_rgba(15,23,42,0.18)] transition-colors ${isActiveDropTarget ? 'border-foreground/40 shadow-[0_0_0_1px_rgba(255,255,255,0.14),0_24px_60px_rgba(15,23,42,0.24)]' : 'border-border/60'}`}
        dragover={(event: DragEvent) => {
          event.preventDefault()
          props.manager.dragOverColumn = props.column
        }}
        dragleave={(event: DragEvent) => {
          const nextTarget = event.relatedTarget as Node | null
          if (!nextTarget || !(event.currentTarget as HTMLElement).contains(nextTarget)) {
            props.manager.dragOverColumn = ''
          }
        }}
        drop={(event: DragEvent) => props.manager.handleDropOnColumn(event, props.column)}
      >
        <div class="border-b border-border/60 px-5 py-4">
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0">
              <div class="flex items-center gap-3">
                <h2 class="text-base font-semibold text-foreground">{props.title}</h2>
                <span class={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium ${props.accentClass}`}>
                  {props.items.length} {props.badgeLabel}
                </span>
              </div>
              <p class="mt-1 text-sm leading-6 text-muted-foreground">{props.description}</p>
            </div>
          </div>
        </div>

        <div class="flex flex-1 flex-col gap-3 p-3">
          {props.items.length === 0 && (
            <div class={`flex h-full min-h-[16rem] flex-col items-center justify-center rounded-xl border border-dashed px-6 text-center ${isActiveDropTarget ? 'border-foreground/40 bg-muted/20' : 'border-border/60 bg-muted/10'}`}>
              <p class="text-sm font-medium text-foreground">Nothing here yet</p>
              <p class="mt-1 max-w-xs text-sm text-muted-foreground">
                {props.column === 'catalog'
                  ? 'Every category will appear here until you drag it into an agent lane.'
                  : 'Drop a category card here to assign it to this moderation agent.'}
              </p>
            </div>
          )}

          {props.items.map(item => {
            const isAssigned = item.type !== null
            const isMoving = !!props.manager.movingCatalogIds[item.catalogId]
            const isToggling = !!props.manager.togglingCatalogIds[item.catalogId]
            const isDragging = props.manager.draggingCatalogId === item.catalogId

            return (
              <article
                key={item.catalogId}
                class={`rounded-[1rem] border px-4 py-4 transition-colors ${isDragging ? 'border-foreground/40 bg-muted/25 opacity-70' : 'border-border/60 bg-background/70 hover:bg-muted/15'} ${isMoving ? 'opacity-70' : ''}`}
                draggable={!isMoving && !isToggling}
                dragstart={(event: DragEvent) => props.manager.handleDragStart(event, item.catalogId)}
                dragend={props.manager.handleDragEnd}
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-2">
                      <div class="flex items-center gap-2 text-muted-foreground">
                        <svg aria-hidden="true" viewBox="0 0 16 16" class="h-4 w-4">
                          <circle cx="5" cy="4" r="1.1" fill="currentColor" />
                          <circle cx="11" cy="4" r="1.1" fill="currentColor" />
                          <circle cx="5" cy="8" r="1.1" fill="currentColor" />
                          <circle cx="11" cy="8" r="1.1" fill="currentColor" />
                          <circle cx="5" cy="12" r="1.1" fill="currentColor" />
                          <circle cx="11" cy="12" r="1.1" fill="currentColor" />
                        </svg>
                      </div>
                      <h3 class="truncate text-sm font-semibold text-foreground">{item.label}</h3>
                      <span class="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                        {item.catalogId}
                      </span>
                      {isAssigned ? (
                        <span class={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${item.enabled ? 'bg-emerald-500/12 text-emerald-300' : 'bg-muted text-muted-foreground'}`}>
                          {item.enabled ? 'Enabled' : 'Paused'}
                        </span>
                      ) : (
                        <span class="inline-flex items-center rounded-full bg-sky-500/12 px-2 py-0.5 text-[11px] font-medium text-sky-300">
                          Unassigned
                        </span>
                      )}
                      {isMoving && (
                        <span class="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                          Saving...
                        </span>
                      )}
                    </div>

                    <p class="mt-3 text-sm leading-6 text-muted-foreground">{item.definition}</p>
                  </div>
                </div>

                {isAssigned ? (
                  <div class="mt-4 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      class="inline-flex h-8 items-center rounded-md border border-border/70 bg-background/80 px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted/30 disabled:pointer-events-none disabled:opacity-50"
                      disabled={isMoving || isToggling}
                      click={() => props.manager.handleToggleEnabled(item.catalogId, item.label, !item.enabled)}
                    >
                      {isToggling ? 'Saving...' : item.enabled ? 'Pause' : 'Enable'}
                    </button>
                    <button
                      type="button"
                      class="inline-flex h-8 items-center rounded-md border border-border/70 bg-background/80 px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted/30 disabled:pointer-events-none disabled:opacity-50"
                      disabled={isMoving || isToggling}
                      click={() => props.manager.handleMoveToCatalog(item.catalogId)}
                    >
                      Remove From Agent
                    </button>
                  </div>
                ) : (
                  <p class="mt-4 text-xs uppercase tracking-[0.12em] text-muted-foreground">
                    Drag into timeout or ban to activate this category.
                  </p>
                )}
              </article>
            )
          })}
        </div>
      </section>
    )
  }
}

export default class ModerationManager extends Component {
  lastLoadedChannel = ''
  draggingCatalogId = ''
  dragOverColumn: BoardColumnType | '' = ''
  movingCatalogIds: Record<string, boolean> = {}
  togglingCatalogIds: Record<string, boolean> = {}
  activeChannel = appStore.activeChannelMeta
  moderationEnabled = appStore.activeChannelMeta?.moderationEnabled ?? true
  agentToggleLoading = false
  removeChannelObservers: Array<() => void> = []
  removeAuthObservers: Array<() => void> = []
  handleDragStart!: (event: DragEvent, catalogId: string) => void
  handleDragEnd!: () => void
  handleDropOnColumn!: (event: DragEvent, targetColumn: BoardColumnType) => Promise<void>
  handleToggleEnabled!: (catalogId: string, label: string, enabled: boolean) => Promise<void>
  handleMoveToCatalog!: (catalogId: string) => Promise<void>
  handleAgentToggle!: (enabled: boolean) => Promise<void>

  constructor() {
    super()
    this.handleDragStart = this._handleDragStart.bind(this)
    this.handleDragEnd = this._handleDragEnd.bind(this)
    this.handleDropOnColumn = this._handleDropOnColumn.bind(this)
    this.handleToggleEnabled = this._handleToggleEnabled.bind(this)
    this.handleMoveToCatalog = this._handleMoveToCatalog.bind(this)
    this.handleAgentToggle = this._handleAgentToggle.bind(this)
  }

  async created() {
    this.syncAgentState()
    this.removeChannelObservers = [
      appStore.observe('activeChannel', () => this.syncAgentState()),
      appStore.observe('channels', () => this.syncAgentState())
    ]
    this.removeAuthObservers = [
      authStore.observe('channelSettingsUpdating', () => this.syncAgentState())
    ]

    const active = appStore.channelId
    if (active) {
      this.lastLoadedChannel = active
      const needsLoad =
        categoryStore.loadedChannelId !== active ||
        categoryStore.categories.length === 0 ||
        categoryStore.catalog.length === 0
      if (needsLoad) {
        await this.loadModerationData(active)
      }
      return
    }

    if (categoryStore.catalog.length === 0) {
      await categoryStore.fetchCatalog()
    }
  }

  dispose() {
    for (const removeObserver of this.removeChannelObservers) {
      removeObserver()
    }
    for (const removeObserver of this.removeAuthObservers) {
      removeObserver()
    }
    super.dispose()
  }

  syncAgentState() {
    const activeChannel = appStore.activeChannelMeta
    this.activeChannel = activeChannel
    this.moderationEnabled = activeChannel?.moderationEnabled ?? true
    this.agentToggleLoading = activeChannel
      ? !!authStore.channelSettingsUpdating[activeChannel.id]
      : false
  }

  async loadModerationData(channelId: string) {
    await Promise.all([
      categoryStore.fetchCatalog(),
      categoryStore.fetchCategories(channelId)
    ])
  }

  loadCategoriesIfNeeded() {
    const active = appStore.channelId
    if (active && active !== this.lastLoadedChannel) {
      this.lastLoadedChannel = active
      this.loadModerationData(active)
    }
  }

  _handleDragStart(event: DragEvent, catalogId: string) {
    this.draggingCatalogId = catalogId
    event.dataTransfer?.setData('text/plain', catalogId)
  }

  _handleDragEnd() {
    this.draggingCatalogId = ''
    this.dragOverColumn = ''
  }

  async _handleDropOnColumn(event: DragEvent, targetColumn: BoardColumnType) {
    event.preventDefault()
    const catalogId = this.draggingCatalogId || event.dataTransfer?.getData('text/plain') || ''
    await this.moveCatalogToColumn(catalogId, targetColumn)
  }

  buildBoardItems() {
    const categoryByCatalogId = new Map(categoryStore.categories.map(category => [category.catalogId, category]))

    return categoryStore.catalog.map(entry => {
      const assigned = categoryByCatalogId.get(entry.catalogId)

      return {
        catalogId: entry.catalogId,
        categoryId: assigned?.id ?? null,
        label: assigned?.label ?? entry.label,
        definition: assigned?.definition ?? entry.definition,
        type: assigned?.type ?? null,
        enabled: assigned?.enabled ?? false
      } satisfies BoardItem
    })
  }

  async moveCatalogToColumn(catalogId: string, targetColumn: BoardColumnType) {
    this.dragOverColumn = ''
    this.draggingCatalogId = ''

    if (!catalogId || this.movingCatalogIds[catalogId]) {
      return
    }

    const existingCategory = categoryStore.categories.find(category => category.catalogId === catalogId)
    const catalogEntry = categoryStore.catalog.find(entry => entry.catalogId === catalogId)

    if (targetColumn === 'catalog') {
      if (!existingCategory) {
        return
      }

      this.movingCatalogIds = { ...this.movingCatalogIds, [catalogId]: true }

      try {
        await categoryStore.deleteCategory(existingCategory.id)
        showSuccessToast({
          title: 'Category Unassigned',
          description: `"${existingCategory.label}" is back in the category list.`
        })
      } catch (err: any) {
        showErrorToast({
          title: 'Move Failed',
          description: err.message || 'Failed to remove this category from the agent.'
        })
      } finally {
        const next = { ...this.movingCatalogIds }
        delete next[catalogId]
        this.movingCatalogIds = next
      }

      return
    }

    if (!catalogEntry) {
      showErrorToast({
        title: 'Category Missing',
        description: 'This category is not available in the moderation catalog.'
      })
      return
    }

    if (!appStore.channelId) {
      showErrorToast({
        title: 'Channel Missing',
        description: 'Select a channel before assigning moderation categories.'
      })
      return
    }

    if (existingCategory?.type === targetColumn) {
      return
    }

    this.movingCatalogIds = { ...this.movingCatalogIds, [catalogId]: true }

    try {
      if (existingCategory) {
        await categoryStore.changeType(existingCategory.id, targetColumn)
        showSuccessToast({
          title: 'Agent Updated',
          description: `"${existingCategory.label}" now routes to the ${targetColumn} agent.`
        })
      } else {
        await categoryStore.createCategory({
          channelId: appStore.channelId,
          catalogId: catalogEntry.catalogId,
          type: targetColumn,
          label: catalogEntry.label,
          definition: catalogEntry.definition,
          enabled: true
        })
        showSuccessToast({
          title: 'Category Assigned',
          description: `"${catalogEntry.label}" now routes to the ${targetColumn} agent.`
        })
      }
    } catch (err: any) {
      showErrorToast({
        title: 'Assignment Failed',
        description: err.message || 'Failed to update this moderation category.'
      })
    } finally {
      const next = { ...this.movingCatalogIds }
      delete next[catalogId]
      this.movingCatalogIds = next
    }
  }

  async _handleToggleEnabled(catalogId: string, label: string, enabled: boolean) {
    const existingCategory = categoryStore.categories.find(category => category.catalogId === catalogId)
    if (!existingCategory) {
      return
    }

    this.togglingCatalogIds = { ...this.togglingCatalogIds, [catalogId]: true }

    try {
      await categoryStore.toggleEnabled(existingCategory.id, enabled)
      showSuccessToast({
        title: enabled ? 'Category Enabled' : 'Category Paused',
        description: `"${label}" has been ${enabled ? 'enabled' : 'paused'}.`
      })
    } catch (err: any) {
      showErrorToast({
        title: 'Update Failed',
        description: err.message || 'Failed to update category status.'
      })
    } finally {
      const next = { ...this.togglingCatalogIds }
      delete next[catalogId]
      this.togglingCatalogIds = next
    }
  }

  async _handleMoveToCatalog(catalogId: string) {
    await this.moveCatalogToColumn(catalogId, 'catalog')
  }

  async _handleAgentToggle(enabled: boolean) {
    const activeChannel = appStore.channelId
    if (!activeChannel || authStore.channelSettingsUpdating[activeChannel]) return

    try {
      this.moderationEnabled = enabled
      const session = await authStore.updateChannelSettings(activeChannel, {
        moderationEnabled: enabled
      })
      if (!session) return

      showSuccessToast({
        title: enabled ? 'Moderation Agent Enabled' : 'Moderation Agent Paused',
        description: enabled
          ? 'Timeout and ban workflows will evaluate incoming live chat again.'
          : 'Moderation categories stay saved, but the live moderation agent is paused for this channel.'
      })
    } catch (err: any) {
      this.syncAgentState()
      showErrorToast({
        title: 'Agent Update Failed',
        description: err.message || 'Failed to update the moderation agent setting.'
      })
    }
  }

  get moderationToggleLabel() {
    if (this.agentToggleLoading) return 'Saving'
    return this.moderationEnabled ? 'Enabled' : 'Paused'
  }


  template() {
    this.loadCategoriesIfNeeded()

    const catalogEntries = categoryStore.catalog
    const boardItems = this.buildBoardItems()
    const availableItems = boardItems.filter(item => item.type === null)
    const timeoutItems = boardItems.filter(item => item.type === 'timeout')
    const banItems = boardItems.filter(item => item.type === 'ban')

    return (
      <div class="space-y-6 max-w-7xl w-full mx-auto px-4 py-6">
        <div class="page-header">
          <div>
            <p class="page-kicker">Chat safety</p>
            <h1 class="page-title">Moderation Rules</h1>
            <p class="page-description">Every category is listed below. Drag cards between the category lane, timeout, and ban just like a Notion board.</p>
          </div>
        </div>

        {this.activeChannel && (
          <section class="rounded-[1.25rem] border border-border/60 bg-card/70 px-5 py-4 shadow-[0_18px_50px_rgba(15,23,42,0.18)]">
            <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p class="text-sm font-semibold text-foreground">Moderation agent status</p>
                <p class="mt-1 text-sm text-muted-foreground">
                  {this.moderationEnabled
                    ? 'The moderation workflow is active and can issue timeout or ban decisions from your assigned categories.'
                    : 'The moderation workflow is paused. Your category board stays saved, but runtime enforcement is disabled.'}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={this.moderationEnabled}
                aria-label={this.moderationToggleLabel}
                disabled={this.agentToggleLoading}
                click={() => {
                  if (!this.agentToggleLoading) {
                    this.handleAgentToggle(!this.moderationEnabled)
                  }
                }}
                class={`status-toggle ${this.moderationEnabled ? 'status-toggle-on' : 'status-toggle-off'} ${this.agentToggleLoading ? 'status-toggle-disabled' : ''}`}
              >
                <span class={`status-toggle-track ${this.moderationEnabled ? 'status-toggle-track-on' : 'status-toggle-track-off'}`}>
                  <span class={`status-toggle-thumb ${this.moderationEnabled ? 'status-toggle-thumb-on' : 'status-toggle-thumb-off'}`}></span>
                </span>
                <span class="status-toggle-label">{this.moderationToggleLabel}</span>
              </button>
            </div>
          </section>
        )}

        {categoryStore.loading && catalogEntries.length === 0 && (
          <div class="flex flex-col items-center justify-center py-20">
            <div class="h-10 w-10 animate-spin rounded-full border-b-2 border-primary"></div>
            <p class="mt-4 text-sm text-muted-foreground">Loading moderation categories...</p>
          </div>
        )}

        {categoryStore.error && !categoryStore.loading && catalogEntries.length === 0 && (
          <Card class="mx-auto max-w-xl border-destructive/50 bg-destructive/5 py-8 backdrop-blur-md">
            <CardHeader class="text-center">
              <div class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-destructive/20 bg-destructive/10 text-destructive">
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              </div>
              <CardTitle class="text-xl font-bold text-destructive">Failed to Load Categories</CardTitle>
              <CardDescription class="mx-auto mt-2 max-w-sm text-muted-foreground">{categoryStore.error}</CardDescription>
            </CardHeader>
            <CardContent class="flex justify-center pt-4">
              <Button click={() => this.loadModerationData(appStore.channelId)}>Retry</Button>
            </CardContent>
          </Card>
        )}

        {catalogEntries.length > 0 && (
          <div class="space-y-4">
            <div class="grid gap-4 xl:grid-cols-3">
              <AgentColumn
                manager={this}
                column="catalog"
                title="Categories"
                description="The full moderation catalog for this channel. Drag a card out of here when you want an agent to enforce it."
                accentClass="bg-slate-500/12 text-slate-300"
                badgeLabel="listed"
                items={availableItems}
              />
              <AgentColumn
                manager={this}
                column="timeout"
                title="Timeout Agent"
                description="Temporary enforcement for spam, escalation control, and lower-severity disruption."
                accentClass="bg-amber-500/12 text-amber-300"
                badgeLabel="assigned"
                items={timeoutItems}
              />
              <AgentColumn
                manager={this}
                column="ban"
                title="Ban Agent"
                description="Permanent enforcement for severe abuse, threats, scams, or malicious behavior."
                accentClass="bg-red-500/12 text-red-300"
                badgeLabel="assigned"
                items={banItems}
              />
            </div>
          </div>
        )}
      </div>
    )
  }
}
