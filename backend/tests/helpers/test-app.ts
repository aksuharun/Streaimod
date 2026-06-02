import { createApp, type AppConfigurer } from '../../src/app.js'

export function createTestApp(configure?: AppConfigurer) {
  return createApp(configure)
}
