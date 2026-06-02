import { Component } from '@geajs/core'
import { Button } from '@geajs/ui'
import qnaStore from '../stores/qna-store'
import StatusToggle from './StatusToggle'
import { showErrorToast, showSuccessToast } from '../services/toast'

interface QnaTableProps {
  entries: any[]
  onEdit: (entry: any) => void
}

export default class QnaTable extends Component {
  togglingIds: Record<string, boolean> = {}
  deletingIds: Record<string, boolean> = {}

  handleToggleEnabled = async (id: string, question: string, enabled: boolean) => {
    if (this.togglingIds[id]) return
    this.togglingIds = { ...this.togglingIds, [id]: true }
    
    try {
      await qnaStore.toggleEnabled(id, enabled)
      showSuccessToast({
        title: enabled ? 'Rule Activated' : 'Rule Paused',
        description: `Automated response for "${question.substring(0, 30)}${question.length > 30 ? '...' : ''}" has been ${enabled ? 'enabled' : 'disabled'}.`
      })
    } catch (err: any) {
      showErrorToast({
        title: 'Toggle Failed',
        description: err.message || 'Failed to update rule status.'
      })
    } finally {
      // Keep the reactive key stable so the switch reliably re-enables.
      this.togglingIds = { ...this.togglingIds, [id]: false }
    }
  }

  handleDelete = async (id: string, question: string) => {
    if (this.deletingIds[id]) return
    if (!confirm(`Are you sure you want to delete the Q&A response rule for "${question.substring(0, 40)}${question.length > 40 ? '...' : ''}"?`)) {
      return
    }

    this.deletingIds = { ...this.deletingIds, [id]: true }
    try {
      await qnaStore.deleteEntry(id)
      showSuccessToast({
        title: 'Rule Deleted',
        description: 'The Q&A response rule has been permanently removed.'
      })
    } catch (err: any) {
      showErrorToast({
        title: 'Delete Failed',
        description: err.message || 'Failed to delete the rule.'
      })
    } finally {
      this.deletingIds = { ...this.deletingIds, [id]: false }
    }
  }

  template(props: QnaTableProps) {
    const { entries, onEdit } = props

    if (entries.length === 0) {
      return (
        <div class="text-center py-12 border border-dashed border-slate-800 rounded-xl bg-slate-950/20 backdrop-blur-sm">
          <p class="text-slate-400 text-sm">No Q&A rules match your search query.</p>
        </div>
      )
    }

    return (
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
            {entries.map((entry) => (
              <tr
                key={entry.id}
                class="hover:bg-slate-900/30 transition-all duration-200 align-middle text-sm text-slate-100"
              >
                {/* Question Section */}
                <td class="py-4.5 px-5 font-semibold leading-normal pr-4">
                  <div class="max-w-[240px] truncate" title={entry.question}>
                    {entry.question}
                  </div>
                </td>

                {/* Answer Section */}
                <td class="py-4.5 px-5 text-slate-300 leading-relaxed pr-4 font-normal">
                  <div class="max-w-[320px] truncate" title={entry.answer}>
                    {entry.answer}
                  </div>
                </td>

                {/* Switch Toggle */}
                <td class="py-4.5 px-5 text-center whitespace-nowrap">
                  <div class="inline-flex justify-center items-center">
                    <StatusToggle
                      checked={entry.enabled}
                      disabled={!!this.togglingIds[entry.id]}
                      onToggle={() =>
                        this.handleToggleEnabled(entry.id, entry.question, !entry.enabled)
                      }
                      label={entry.enabled ? 'Active' : 'Paused'}
                    />
                  </div>
                </td>

                {/* Actions Button */}
                <td class="py-4.5 px-5 text-right whitespace-nowrap">
                  <div class="inline-flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      click={() => onEdit(entry)}
                      class="px-3.5 py-1.5 text-xs text-slate-300 hover:text-white hover:border-teal-500/40 border-slate-800 bg-slate-950/40 hover:bg-slate-900 transition-all duration-200"
                    >
                      Edit
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={this.deletingIds[entry.id]}
                      click={() => this.handleDelete(entry.id, entry.question)}
                      class="px-3.5 py-1.5 text-xs font-semibold shadow-sm hover:shadow-[0_0_10px_rgba(239,68,68,0.2)] transition-all duration-200"
                    >
                      {this.deletingIds[entry.id] ? 'Deleting...' : 'Delete'}
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
