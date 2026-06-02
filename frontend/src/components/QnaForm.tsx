import { Component } from '@geajs/core'
import { Button, Textarea, Label, Switch } from '@geajs/ui'
import qnaStore from '../stores/qna-store'
import channelStore from '../stores/channel-store'
import { showErrorToast, showSuccessToast } from '../services/toast'

interface QnaFormProps {
  entry?: any // The Q&A entry to edit, if any
  onSave: (savedEntry: any) => void
  onCancel: () => void
}

export default class QnaForm extends Component {
  question = ''
  answer = ''
  enabled = true
  isSaving = false

  created(props: any) {
    if (props.entry) {
      this.question = props.entry.question || ''
      this.answer = props.entry.answer || ''
      this.enabled = props.entry.enabled !== undefined ? props.entry.enabled : true
    } else {
      this.question = ''
      this.answer = ''
      this.enabled = true
    }
  }

  handleSubmit = async (e: any) => {
    e.preventDefault()
    
    const q = this.question.trim()
    const a = this.answer.trim()

    if (!q) {
      showErrorToast({ title: 'Validation Error', description: 'Question field is required.' })
      return
    }
    if (!a) {
      showErrorToast({ title: 'Validation Error', description: 'Answer field is required.' })
      return
    }

    this.isSaving = true
    const props = this.props as any

    try {
      let result
      if (props.entry) {
        // Edit existing Q&A
        result = await qnaStore.updateEntry(props.entry.id, {
          question: q,
          answer: a,
          enabled: this.enabled
        })
        showSuccessToast({ title: 'Q&A Updated', description: 'Rule updated successfully.' })
      } else {
        // Create new Q&A
        const activeChannel = channelStore.activeChannel
        if (!activeChannel) {
          showErrorToast({ title: 'Error', description: 'No active channel selected' })
          return
        }
        result = await qnaStore.addEntry(q, a, this.enabled)
        showSuccessToast({ title: 'Q&A Created', description: 'Rule created successfully.' })
      }
      props.onSave?.(result)
    } catch (err: any) {
      showErrorToast({
        title: 'Error Saving',
        description: err.message || 'Failed to save Q&A entry.'
      })
    } finally {
      this.isSaving = false
    }
  }

  template(props: QnaFormProps) {
    const isEdit = !!props.entry

    return (
      <form onSubmit={this.handleSubmit} class="space-y-5 p-5 border border-slate-800 rounded-xl bg-slate-950/20 backdrop-blur-md max-w-xl w-full mx-auto animate-fade-in">
        <h3 class="text-lg font-bold text-slate-100 mb-2">
          {isEdit ? 'Modify Q&A Rule' : 'Create New Q&A Rule'}
        </h3>
        
        <div class="space-y-2">
          <Label htmlFor="question-input" class="text-slate-300">Question / Matching Keywords</Label>
          <Textarea
            inputId="question-input"
            placeholder="e.g. what is the playlist or music?"
            value={this.question}
            rows={3}
            onInput={(e: any) => { this.question = e.target.value }}
            class="bg-slate-900/80 border-slate-800 text-slate-100 focus:border-teal-500/50 min-h-[80px]"
          />
        </div>

        <div class="space-y-2">
          <Label htmlFor="answer-input" class="text-slate-300">Automated Answer</Label>
          <Textarea
            inputId="answer-input"
            placeholder="e.g. The playlist is Chill Synth Beats. You can find it at: spotify.com/..."
            value={this.answer}
            rows={4}
            onInput={(e: any) => { this.answer = e.target.value }}
            class="bg-slate-900/80 border-slate-800 text-slate-100 focus:border-teal-500/50 min-h-[100px]"
          />
        </div>

        <div class="flex items-center justify-between border border-slate-850 rounded-lg p-3.5 bg-slate-900/40">
          <div class="space-y-0.5">
            <span class="text-sm font-semibold text-slate-200">Enable Response Rule</span>
            <p class="text-xs text-slate-400">If enabled, the bot will auto-respond to users matching this question.</p>
          </div>
          <Switch
            inputId="enabled-switch"
            checked={this.enabled}
            onCheckedChange={(d: any) => { this.enabled = d.checked }}
            label={this.enabled ? 'Active' : 'Paused'}
          />
        </div>

        <div class="flex justify-end gap-3 pt-3 border-t border-slate-900">
          <Button type="button" variant="outline" disabled={this.isSaving} click={props.onCancel} class="text-slate-300 border-slate-800 hover:bg-slate-900">
            Cancel
          </Button>
          <Button 
            type="submit" 
            disabled={this.isSaving}
            class="bg-teal-500 hover:bg-teal-600 text-slate-950 font-bold transition-all duration-300 shadow-[0_0_12px_rgba(20,184,166,0.2)]"
          >
            {this.isSaving ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Rule'}
          </Button>
        </div>
      </form>
    )
  }
}
