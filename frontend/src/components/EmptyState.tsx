import { Component } from '@geajs/core'
import { Button } from '@geajs/ui'

interface EmptyStateProps {
  icon?: any
  title: string
  description: string
  actionLabel?: string
  onAction?: () => void
}

export default class EmptyState extends Component {
  template(props: EmptyStateProps) {
    const { icon, title, description, actionLabel, onAction } = props

    return (
      <div class="flex flex-col items-center justify-center p-8 text-center border border-dashed border-slate-800 rounded-2xl bg-slate-950/20 backdrop-blur-md max-w-md mx-auto my-8 space-y-4 animate-fade-in shadow-[0_4px_30px_rgba(0,0,0,0.4)]">
        <div class="w-16 h-16 rounded-full bg-teal-500/10 flex items-center justify-center text-teal-400 border border-teal-500/20 shadow-[0_0_15px_rgba(20,184,166,0.1)]">
          {icon || (
            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          )}
        </div>
        <div class="space-y-1.5">
          <h3 class="text-lg font-bold text-slate-100 tracking-tight">{title}</h3>
          <p class="text-sm text-slate-400 max-w-xs mx-auto leading-relaxed">{description}</p>
        </div>
        {actionLabel && onAction && (
          <Button
            click={onAction}
            class="bg-slate-900 border border-slate-850 hover:border-teal-500/50 hover:bg-teal-500/10 text-slate-200 hover:text-teal-400 px-5 py-2 text-sm font-semibold rounded-lg transition-all duration-300 shadow-md flex items-center gap-2 group"
          >
            {actionLabel}
          </Button>
        )}
      </div>
    )
  }
}
