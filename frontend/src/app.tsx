import { Component, Outlet } from '@geajs/core'
import { router } from './router'
import authStore from './stores/auth-store'
import channelStore from './stores/channel-store'
import AppShell from './views/AppShell'
import Dashboard from './views/Dashboard'
import LandingPage from './views/LandingPage'
import Onboarding from './views/Onboarding'
import QnaManager from './views/QnaManager'
import ModerationManager from './views/ModerationManager'
import NotFound from './views/NotFound'

// Guard: redirect to onboarding if no channel is configured
function requireChannelGuard() {
  if (!authStore.isAuthenticated || !channelStore.hasConfiguredChannel) {
    return '/onboarding'
  }
  return true
}

// Setup router paths and active views.
// /onboarding must be registered BEFORE / in the object so that the router's
// Object.keys() iteration checks it first. The / prefix route with children
// greedily matches any path starting with /, so /onboarding would be captured
// by the layout route if / is checked first and no child matches.
router.setRoutes({
  '/onboarding': Onboarding,
  '/dashboard': {
    layout: AppShell,
    guard: requireChannelGuard,
    children: {
      '/': Dashboard
    }
  },
  '/qna': {
    layout: AppShell,
    guard: requireChannelGuard,
    children: {
      '/': QnaManager
    }
  },
  '/moderation': {
    layout: AppShell,
    guard: requireChannelGuard,
    children: {
      '/': ModerationManager
    }
  },
  '/': LandingPage,
  '*': NotFound
})

export default class App extends Component {
  template() {
    return <Outlet />
  }
}
