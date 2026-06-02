import { Component, Outlet } from '@geajs/core'
import { Toaster } from '@geajs/ui'
import Sidebar from '../components/Sidebar'

export default class AppShell extends Component {
  template() {
    return (
      <div class="min-h-screen flex bg-slate-950 text-slate-100 font-sans selection:bg-sky-500/30 selection:text-sky-200">
        <Toaster
          class="top-4 right-4 w-[min(28rem,calc(100vw-2rem))]"
          storeProps={{ placement: 'top-end', duration: 4000, removeDelay: 200, max: 2 }}
        />
        <Sidebar />

        <div class="flex-1 flex flex-col min-w-0 h-screen overflow-y-auto">
          <main class="flex-1 w-full px-6 py-8">
            <Outlet />
          </main>
        </div>
      </div>
    )
  }
}
