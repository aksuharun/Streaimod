import { Component } from '@geajs/core'
import { Dialog, Button, Switch, Select } from '@geajs/ui'
import categoryStore from '../stores/category-store'
import appStore from '../stores/channel-store'
import { showErrorToast, showSuccessToast } from '../services/toast'

interface BootstrapDialogProps {
  onComplete?: () => void
}

interface BootstrapItem {
  catalogId: string
  label: string
  definition: string
  type: 'ban' | 'timeout'
  enabled: boolean
}

export default class BootstrapDialog extends Component {
  open = false
  selections: BootstrapItem[] = []

  created() {
    this.resetSelections()
  }

  resetSelections() {
    // Standard default mapping based on project-context.md legacy groups
    const banDefaults = ['SCAM', 'THREAT', 'MINOR_EXPLOITATION', 'MALWARE', 'DOXXING', 'SEVERE_HATE']
    
    this.selections = categoryStore.catalog.map(entry => ({
      catalogId: entry.catalogId,
      label: entry.label,
      definition: entry.definition,
      type: banDefaults.includes(entry.catalogId) ? 'ban' : 'timeout',
      enabled: true
    }))
  }

  handleOpenChange = (details: { open: boolean }) => {
    this.open = details.open
    if (details.open) {
      this.resetSelections()
    }
  }

  toggleEnabled = (catalogId: string, checked: boolean) => {
    this.selections = this.selections.map(item =>
      item.catalogId === catalogId ? { ...item, enabled: checked } : item
    )
  }

  handleTypeChange = (catalogId: string, val: string) => {
    this.selections = this.selections.map(item =>
      item.catalogId === catalogId
        ? { ...item, type: val as 'ban' | 'timeout' }
        : item
    )
  }

  handleConfirm = async () => {
    try {
      const payload = this.selections.map(s => ({
        catalogId: s.catalogId,
        type: s.type,
        enabled: s.enabled
      }))

      await categoryStore.bootstrap(appStore.channelId, payload)
      ;(this.props as BootstrapDialogProps).onComplete?.()
      showSuccessToast({
        title: 'Bootstrap Successful',
        description: `Successfully configured ${payload.length} categories.`
      })
      this.open = false
    } catch (err: any) {
      showErrorToast({
        title: 'Bootstrap Failed',
        description: err.message || 'Could not bootstrap categories.'
      })
    }
  }

  template() {
    return (
      <Dialog
        title="Bootstrap Channel Categories"
        description="Quickly initialize your channel's AI moderation with all 13 canonical categories."
        triggerLabel="Bootstrap Categories"
        open={this.open}
        onOpenChange={this.handleOpenChange}
        class="max-w-2xl"
      >
        <div class="mt-4 flex flex-col gap-4">
          <div class="max-h-[60vh] overflow-y-auto pr-2 flex flex-col gap-4 border border-border/40 rounded-lg p-3 bg-card/30 backdrop-blur-md">
            {this.selections.map((item) => (
              <div key={item.catalogId} class="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-3 rounded-lg border border-border/30 bg-card/50 hover:bg-card/80 transition-all duration-200">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 mb-1 flex-wrap">
                    <span class="font-semibold text-foreground text-sm">{item.label}</span>
                  </div>
                  <p class="text-xs text-muted-foreground line-clamp-2 pr-4">{item.definition}</p>
                </div>

                <div class="flex items-center gap-3 self-end md:self-auto shrink-0 flex-wrap">
                  <div class="w-32">
                    <Select
                      items={[
                        { value: 'ban', label: 'Ban Rule' },
                        { value: 'timeout', label: 'Timeout' }
                      ]}
                      value={[item.type]}
                      onValueChange={(d: any) => this.handleTypeChange(item.catalogId, d.value[0])}
                    />
                  </div>
                  <div class="flex items-center justify-center pt-2">
                    <Switch
                      checked={item.enabled}
                      onCheckedChange={(d: any) => this.toggleEnabled(item.catalogId, d.checked)}
                      label={item.enabled ? "On" : "Off"}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div class="flex justify-end gap-3 pt-2 mt-2 border-t border-border/40">
            <Button variant="outline" click={() => { this.open = false }}>
              Cancel
            </Button>
            <Button click={this.handleConfirm}>
              Confirm & Bootstrap
            </Button>
          </div>
        </div>
      </Dialog>
    )
  }
}
