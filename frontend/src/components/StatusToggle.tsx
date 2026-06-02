import { Component, GEA_ON_PROP_CHANGE } from '@geajs/core'

interface StatusToggleProps {
  checked: boolean
  disabled?: boolean
  label: string
  onToggle: () => void
}

export default class StatusToggle extends Component {
  declare props: StatusToggleProps
  checked = false
  disabled = false
  label = ''

  created(props: StatusToggleProps) {
    this.syncFromProps(props)
  }

  [GEA_ON_PROP_CHANGE](_key: string, _next: unknown) {
    this.syncFromProps(this.props)
  }

  syncFromProps(props: StatusToggleProps) {
    this.checked = !!props.checked
    this.disabled = props.disabled ?? false
    this.label = props.label
  }

  template() {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={this.checked}
        aria-label={this.label}
        disabled={this.disabled}
        click={() => {
          if (!this.disabled) {
            this.props.onToggle()
          }
        }}
        class={`status-toggle ${this.checked ? 'status-toggle-on' : 'status-toggle-off'} ${this.disabled ? 'status-toggle-disabled' : ''}`}
      >
        <span class={`status-toggle-track ${this.checked ? 'status-toggle-track-on' : 'status-toggle-track-off'}`}>
          <span class={`status-toggle-thumb ${this.checked ? 'status-toggle-thumb-on' : 'status-toggle-thumb-off'}`}></span>
        </span>
        <span class="status-toggle-label">{this.label}</span>
      </button>
    )
  }
}
