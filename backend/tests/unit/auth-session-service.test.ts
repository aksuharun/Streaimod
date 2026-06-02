import {
  clearSessionCookieHeader,
  createSessionCookieHeader
} from '../../src/services/auth-session-service.js'
import { withTemporaryEnv } from '../helpers/env.js'

describe('auth session cookies', () => {
  it('uses Lax same-site cookies by default outside production', async () => {
    await withTemporaryEnv(
      {
        SESSION_SECRET: 'test-secret',
        SESSION_COOKIE_SAME_SITE: undefined,
        NODE_ENV: 'test'
      },
      async () => {
        const cookie = createSessionCookieHeader('user-123')

        expect(cookie).toContain('SameSite=Lax')
        expect(cookie).not.toContain('Secure')
      }
    )
  })

  it('uses None plus Secure when configured for cross-site production auth', async () => {
    await withTemporaryEnv(
      {
        SESSION_SECRET: 'test-secret',
        SESSION_COOKIE_SAME_SITE: 'none',
        NODE_ENV: 'production'
      },
      async () => {
        const cookie = createSessionCookieHeader('user-123')

        expect(cookie).toContain('SameSite=None')
        expect(cookie).toContain('Secure')
      }
    )
  })

  it('throws on invalid same-site configuration', async () => {
    await withTemporaryEnv(
      {
        SESSION_SECRET: 'test-secret',
        SESSION_COOKIE_SAME_SITE: 'invalid',
        NODE_ENV: 'test'
      },
      async () => {
        expect(() => clearSessionCookieHeader()).toThrow(
          /SESSION_COOKIE_SAME_SITE must be one of: lax, strict, none/
        )
      }
    )
  })
})
