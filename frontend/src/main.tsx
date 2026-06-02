import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './app'
import './styles/index.css'

const root = document.getElementById('app')

if (!root) {
  throw new Error('App root element not found')
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
