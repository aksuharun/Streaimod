import { Component, Link } from '@geajs/core'
import ChannelSelector from './ChannelSelector'

export default class Sidebar extends Component {
  template() {
    return (
      <aside class="w-[280px] bg-slate-950 border-r border-slate-900 flex flex-col h-screen select-none shrink-0">
        <div class="p-5 border-b border-slate-900 flex items-center gap-3">
          <div class="w-9 h-9 rounded-md bg-cyan-400 flex items-center justify-center">
            <span class="text-slate-950 font-black text-lg">M</span>
          </div>
          <div>
            <h1 class="text-base font-bold text-slate-100 tracking-tight leading-none">
              AI Moderator
            </h1>
            <span class="text-[10px] font-semibold text-teal-400 uppercase tracking-widest">
              Management UI
            </span>
          </div>
        </div>

        <div class="p-5 border-b border-slate-900/60">
          <ChannelSelector />
        </div>

        <nav class="flex-1 px-4 py-6 space-y-2 overflow-y-auto">
          <Link
            to="/dashboard"
            label="Dashboard"
            exact={true}
            class="sidebar-link"
          />
          <Link
            to="/qna"
            label="Q&A Rules"
            class="sidebar-link"
          />
          <Link
            to="/moderation"
            label="Moderation Rules"
            class="sidebar-link"
          />
        </nav>

        <div class="p-4 border-t border-slate-900 bg-slate-950/80 flex items-center justify-between text-xs text-slate-500">
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-slate-600"></span>
            <span>AI Moderator</span>
          </div>
          <span class="text-[10px] font-mono">v0.1.0</span>
        </div>
      </aside>
    )
  }
}
