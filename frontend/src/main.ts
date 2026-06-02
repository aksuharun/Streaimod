import '@geajs/ui/style.css'
import './styles/index.css'
import authStore from './stores/auth-store'

const root = document.getElementById('app')

if (!root) {
  throw new Error('App root element not found')
}

await authStore.bootstrap()

const { default: App } = await import('./app')

const app = new App()
app.render(root)
