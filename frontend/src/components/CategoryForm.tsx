import { Component } from '@geajs/core'
import { Button, Textarea, Label, Select, Switch } from '@geajs/ui'
import categoryStore from '../stores/category-store'
import appStore from '../stores/channel-store'
import { showErrorToast, showSuccessToast } from '../services/toast'

interface CategoryFormProps {
  category?: any // The category to edit, if any
  initialType?: 'ban' | 'timeout'
  onSave: (savedCategory: any) => void
  onCancel: () => void
}

export default class CategoryForm extends Component {
  catalogId = ''
  type: 'ban' | 'timeout' = 'ban'
  label = ''
  definition = ''
  enabled = true
  isSaving = false

  handleLabelInput = (e: any) => {
    this.label = e.target.value
  }

  created(props: any) {
    if (props.category) {
      this.catalogId = props.category.catalogId || ''
      this.type = props.category.type || 'ban'
      this.label = props.category.label || ''
      this.definition = props.category.definition || ''
      this.enabled = props.category.enabled !== undefined ? props.category.enabled : true
    } else {
      // Setup default new category state
      this.catalogId = ''
      this.type = props.initialType || 'ban'
      this.label = ''
      this.definition = ''
      this.enabled = true
    }
  }

  handleCatalogChange = (val: string) => {
    this.catalogId = val
    const catalogEntry = categoryStore.catalog.find(c => c.catalogId === val)
    if (catalogEntry) {
      this.label = catalogEntry.label
      this.definition = catalogEntry.definition
    }
  }

  handleSubmit = async (e: any) => {
    e.preventDefault()
    if (!this.catalogId) {
      showErrorToast({ title: 'Validation Error', description: 'Catalog ID is required' })
      return
    }
    if (!this.label.trim()) {
      showErrorToast({ title: 'Validation Error', description: 'Label is required' })
      return
    }
    if (!this.definition.trim()) {
      showErrorToast({ title: 'Validation Error', description: 'Definition is required' })
      return
    }

    this.isSaving = true
    const props = this.props as any

    try {
      let result
      if (props.category) {
        // Edit existing
        result = await categoryStore.updateCategory(props.category.id, {
          type: this.type,
          label: this.label,
          definition: this.definition,
          enabled: this.enabled
        })
        showSuccessToast({ title: 'Category Updated', description: `Successfully updated "${this.label}"` })
      } else {
        // Create new
        result = await categoryStore.createCategory({
          channelId: appStore.channelId,
          catalogId: this.catalogId,
          type: this.type,
          label: this.label,
          definition: this.definition,
          enabled: this.enabled
        })
        showSuccessToast({ title: 'Category Created', description: `Successfully created "${this.label}"` })
      }
      props.onSave?.(result)
    } catch (err: any) {
      showErrorToast({
        title: 'Error Saving',
        description: err.message || 'Failed to save moderation category.'
      })
    } finally {
      this.isSaving = false
    }
  }

  template(props: CategoryFormProps) {
    const isEdit = !!props.category
    
    const catalogItems = categoryStore.catalog.map(c => ({
      value: c.catalogId,
      label: c.label
    }))
    const selectedCatalog = categoryStore.catalog.find(c => c.catalogId === this.catalogId)

    return (
      <form onSubmit={this.handleSubmit} class="space-y-5 p-5 border border-border/40 rounded-xl bg-card/25 backdrop-blur-md max-w-xl w-full mx-auto">
        <h3 class="text-lg font-bold text-foreground mb-4">
          {isEdit ? `Edit Rule: ${this.label}` : 'Create Moderation Rule'}
        </h3>

        <div class="space-y-2">
          <Label htmlFor="catalog-select">Rule Category</Label>
          {isEdit ? (
            <div class="px-3 py-2 border border-border/40 rounded-md bg-muted/20 text-sm text-foreground">
              {selectedCatalog?.label || this.label}
              <span class="ml-2 text-xs text-muted-foreground">Source category cannot be changed after creation.</span>
            </div>
          ) : (
            <Select
              inputId="catalog-select"
              items={catalogItems}
              placeholder="Select a canonical category..."
              value={this.catalogId ? [this.catalogId] : []}
              onValueChange={(d: any) => this.handleCatalogChange(d.value[0] || '')}
            />
          )}
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="space-y-2">
            <Label htmlFor="type-select">Assigned Agent</Label>
            <Select
              inputId="type-select"
              items={[
                { value: 'ban', label: 'Ban Agent' },
                { value: 'timeout', label: 'Timeout Agent' }
              ]}
              value={[this.type]}
              onValueChange={(d: any) => { this.type = (d.value[0] || 'ban') as 'ban' | 'timeout' }}
            />
          </div>

          <div class="space-y-2">
            <Label htmlFor="enabled-switch">Initial State</Label>
            <div class="flex items-center h-[42px] border border-border/40 rounded-md px-3 bg-card/40">
              <Switch
                inputId="enabled-switch"
                checked={this.enabled}
                onCheckedChange={(d: any) => { this.enabled = d.checked }}
                label={this.enabled ? 'Enabled' : 'Disabled'}
              />
            </div>
          </div>
        </div>

        <div class="space-y-2">
          <Label htmlFor="label-input">Label</Label>
          <input
            id="label-input"
            type="text"
            placeholder="e.g. Hate Speech"
            value={this.label}
            input={this.handleLabelInput}
            class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
          />
        </div>

        <div class="space-y-2">
          <Label htmlFor="definition-input">Definition</Label>
          <Textarea
            inputId="definition-input"
            placeholder="Define what constitutes this category..."
            value={this.definition}
            rows={3}
            onInput={(e: any) => { this.definition = e.target.value }}
          />
        </div>

        <div class="flex justify-end gap-3 pt-3 border-t border-border/20">
          <Button type="button" variant="outline" disabled={this.isSaving} click={props.onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={this.isSaving}>
            {this.isSaving ? 'Saving...' : isEdit ? 'Update Category' : 'Create Category'}
          </Button>
        </div>
      </form>
    )
  }
}
