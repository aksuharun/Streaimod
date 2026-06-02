import { Component } from '@geajs/core'
import { Button } from '@geajs/ui'
import categoryStore from '../stores/category-store'
import StatusToggle from './StatusToggle'
import { showErrorToast, showSuccessToast } from '../services/toast'

interface CategoryTableProps {
  categories: any[]
  onEdit: (category: any) => void
}

export default class CategoryTable extends Component {
  togglingIds: Record<string, boolean> = {}
  deletingIds: Record<string, boolean> = {}

  handleToggleEnabled = async (id: string, label: string, enabled: boolean) => {
    if (this.togglingIds[id]) return
    this.togglingIds = { ...this.togglingIds, [id]: true }
    
    try {
      await categoryStore.updateCategory(id, { enabled })
      showSuccessToast({
        title: enabled ? 'Category Enabled' : 'Category Disabled',
        description: `"${label}" is now ${enabled ? 'active' : 'inactive'}.`
      })
    } catch (err: any) {
      showErrorToast({
        title: 'Update Failed',
        description: err.message || 'Failed to update category state.'
      })
    } finally {
      this.togglingIds = { ...this.togglingIds, [id]: false }
    }
  }

  handleDelete = async (id: string, label: string) => {
    if (this.deletingIds[id]) return
    if (!confirm(`Are you sure you want to delete the moderation rule for "${label}"?`)) {
      return
    }

    this.deletingIds = { ...this.deletingIds, [id]: true }
    try {
      await categoryStore.deleteCategory(id)
      showSuccessToast({
        title: 'Category Deleted',
        description: `Successfully removed rule for "${label}"`
      })
    } catch (err: any) {
      showErrorToast({
        title: 'Delete Failed',
        description: err.message || 'Failed to delete category.'
      })
    } finally {
      this.deletingIds = { ...this.deletingIds, [id]: false }
    }
  }

  template(props: CategoryTableProps) {
    const { categories, onEdit } = props

    if (categories.length === 0) {
      return (
        <div class="text-center py-10 border border-dashed border-border/40 rounded-xl bg-card/10 backdrop-blur-sm">
          <p class="text-muted-foreground text-sm">No rules configured in this section.</p>
        </div>
      )
    }

    return (
      <div class="overflow-x-auto border border-border/30 rounded-xl bg-card/15 backdrop-blur-md">
        <table class="w-full text-left border-collapse">
          <thead>
            <tr class="border-b border-border/20 bg-muted/10 text-muted-foreground text-xs font-bold uppercase tracking-wider">
              <th class="py-3.5 px-4">Rule Name</th>
              <th class="py-3.5 px-4">Definition</th>
              <th class="py-3.5 px-4 text-center">Status</th>
              <th class="py-3.5 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border/10">
            {categories.map((category) => (
              <tr
                key={category.id}
                class="hover:bg-card/30 transition-colors duration-150 align-middle text-sm text-foreground"
              >
                <td class="py-4 px-4 font-semibold whitespace-nowrap">
                  {category.label}
                </td>
                <td class="py-4 px-4 text-muted-foreground max-w-xs md:max-w-md truncate">
                  {category.definition}
                </td>
                <td class="py-4 px-4 text-center whitespace-nowrap">
                  <div class="inline-flex justify-center items-center">
                    <StatusToggle
                      checked={category.enabled}
                      disabled={!!this.togglingIds[category.id]}
                      onToggle={() =>
                        this.handleToggleEnabled(category.id, category.label, !category.enabled)
                      }
                      label={category.enabled ? 'Active' : 'Paused'}
                    />
                  </div>
                </td>
                <td class="py-4 px-4 text-right whitespace-nowrap">
                  <div class="inline-flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      click={() => onEdit(category)}
                      class="px-3 py-1 text-xs"
                    >
                      Edit
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={this.deletingIds[category.id]}
                      click={() => this.handleDelete(category.id, category.label)}
                      class="px-3 py-1 text-xs"
                    >
                      {this.deletingIds[category.id] ? 'Deleting...' : 'Delete'}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
}
