import { expect, test, type Page, type Route } from '@playwright/test'

function createAuthenticatedSession(settings: { qnaEnabled?: boolean; moderationEnabled?: boolean } = {}) {
  return {
    user: {
      id: 'user-1',
      email: 'creator@example.com',
      name: 'Creator User',
      picture: null,
      activeChannelId: 'UCAuthenticatedChannel',
      channels: [
        {
          channelId: 'UCAuthenticatedChannel',
          name: 'Authenticated Channel',
          handle: '@authenticated',
          thumbnail: null,
          qnaEnabled: settings.qnaEnabled ?? true,
          moderationEnabled: settings.moderationEnabled ?? true,
        }
      ]
    }
  }
}

async function mockUnauthenticatedSession(page: Page) {
  await page.route('**/api/auth/me', async route => {
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Authentication required' })
    })
  })
}

async function mockAuthenticatedSession(page: Page, settings: { qnaEnabled?: boolean; moderationEnabled?: boolean } = {}) {
  await page.route('**/api/auth/me', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createAuthenticatedSession(settings))
    })
  })
}

async function mockChannelSettingsApi(page: Page, initialSettings: { qnaEnabled?: boolean; moderationEnabled?: boolean } = {}) {
  let settings = {
    qnaEnabled: initialSettings.qnaEnabled ?? true,
    moderationEnabled: initialSettings.moderationEnabled ?? true,
  }

  await page.route('**/api/auth/channels/**/settings', async route => {
    const payload = JSON.parse(route.request().postData() || '{}')
    settings = {
      ...settings,
      ...payload,
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createAuthenticatedSession(settings)),
    })
  })
}

async function mockDashboardApis(page: Page) {
  let runtimeStatus = {
    active: false,
    channelId: 'UCAuthenticatedChannel',
    streamId: null as string | null,
    startedAt: null as string | null
  }

  const fulfillStreams = async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        active: [
          {
            id: 'stream-1',
            platform: 'youtube',
            title: 'Weekly live build',
            status: 'live',
            viewerCount: 128,
            startsAt: '2026-06-01T18:00:00.000Z',
            fetchedAt: '2026-05-31T12:00:00.000Z'
          }
        ],
        scheduled: [],
        fetchedAt: '2026-05-31T12:00:00.000Z'
      })
    })
  }

  await page.route(/.*\/api\/streams(\?.*)?$/, fulfillStreams)
  await page.route(/.*\/api\/stream\/status(\?.*)?$/, async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(runtimeStatus)
    })
  })
  await page.route(/.*\/api\/stream\/start$/, async route => {
    runtimeStatus = {
      active: true,
      channelId: 'UCAuthenticatedChannel',
      streamId: 'stream-1',
      startedAt: '2026-05-31T12:05:00.000Z'
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(runtimeStatus)
    })
  })
  await page.route(/.*\/api\/stream\/stop$/, async route => {
    runtimeStatus = {
      active: false,
      channelId: 'UCAuthenticatedChannel',
      streamId: null,
      startedAt: null
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(runtimeStatus)
    })
  })
  await page.route(/.*\/health$/, async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok' })
    })
  })
}

async function mockModerationApis(page: Page) {
  let categories = [
    {
      id: 'cat-ban-1',
      channelId: 'UCAuthenticatedChannel',
      catalogId: 'SCAM',
      type: 'ban',
      label: 'Scam Links',
      definition: 'Messages that attempt to scam users with malicious links.',
      enabled: true,
    },
    {
      id: 'cat-timeout-1',
      channelId: 'UCAuthenticatedChannel',
      catalogId: 'SPAM',
      type: 'timeout',
      label: 'Repeated Spam',
      definition: 'Repeated low-value messages and emoji floods.',
      enabled: true,
    },
  ]

  await page.route('**/api/moderation-catalog', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          catalogId: 'SCAM',
          label: 'Scam Links',
          definition: 'Messages that attempt to scam users with malicious links.',
        },
        {
          catalogId: 'SPAM',
          label: 'Repeated Spam',
          definition: 'Repeated low-value messages and emoji floods.',
        },
        {
          catalogId: 'HARASSMENT',
          label: 'Harassment',
          definition: 'Targeted abusive messages meant to intimidate or pile on.',
        },
      ]),
    })
  })

  await page.route('**/api/moderation-categories**', async route => {
    const method = route.request().method()
    const requestUrl = new URL(route.request().url())
    const pathParts = requestUrl.pathname.split('/').filter(Boolean)
    const id = pathParts[pathParts.length - 1]

    if (method === 'GET' && requestUrl.pathname === '/api/moderation-categories') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(categories),
      })
      return
    }

    if (method === 'POST' && requestUrl.pathname === '/api/moderation-categories') {
      const payload = JSON.parse(route.request().postData() || '{}')
      const created = {
        id: `cat-${payload.catalogId?.toLowerCase?.() || 'new'}`,
        channelId: payload.channelId,
        catalogId: payload.catalogId,
        type: payload.type,
        label: payload.label,
        definition: payload.definition,
        enabled: payload.enabled ?? true,
      }
      categories = [...categories, created]

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(created),
      })
      return
    }

    if (method === 'PATCH') {
      const payload = JSON.parse(route.request().postData() || '{}')
      categories = categories.map(category =>
        category.id === id ? { ...category, ...payload } : category
      )

      const updated = categories.find(category => category.id === id)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(updated),
      })
      return
    }

    if (method === 'DELETE') {
      categories = categories.filter(category => category.id !== id)
      await route.fulfill({
        status: 204,
        contentType: 'application/json',
        body: '',
      })
      return
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(categories),
    })
  })
}

async function mockQnaApis(page: Page) {
  await page.route('**/api/qna**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    })
  })
}

test.describe('Google OAuth onboarding', () => {
  test('fresh load shows the public landing page', async ({ page }) => {
    await mockUnauthenticatedSession(page)

    await page.goto('/')

    await expect(page.getByRole('heading', { name: 'Keep livestream conversations useful, safe, and alive.' })).toBeVisible()
    await expect(page.getByText('Q&A evaluation workflow')).toBeVisible()
    await expect(page.getByText('Automated polls that keep viewers participating.')).toBeVisible()
    await expect(page.locator('#channel-input')).toHaveCount(0)
    await expect(page.getByText('Required scopes')).toHaveCount(0)
  })

  test('landing navigation scrolls to the requested section', async ({ page }) => {
    await mockUnauthenticatedSession(page)

    await page.goto('/')
    await page.getByRole('button', { name: 'Features' }).click()

    await expect.poll(async () => {
      return page.locator('#features').evaluate((node) => {
        return Math.abs(node.getBoundingClientRect().top) < 12
      })
    }).toBe(true)
  })

  test('Continue with Google navigates to backend OAuth start endpoint', async ({ page }) => {
    await mockUnauthenticatedSession(page)

    await page.route('**/api/auth/google/start', async route => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Google OAuth is not configured' })
      })
    })

    await page.goto('/onboarding')
    await page.getByRole('button', { name: 'Continue with Google' }).click()

    await expect.poll(() => page.url()).toMatch(/\/api\/auth\/google\/start|accounts\.google\.com/)
  })

  test('authenticated session redirects from onboarding to dashboard shell', async ({ page }) => {
    await mockAuthenticatedSession(page)
    await mockDashboardApis(page)

    await page.goto('/onboarding')
    await page.waitForURL('**/dashboard')

    await expect(page.locator('aside')).toBeVisible()
    await expect(page.locator('body')).toContainText('Authenticated Channel')
    await expect(page.locator('body')).not.toContainText('creator@example.com')
    await expect(page.locator('body')).not.toContainText('UCAuthenticatedChannel')
    await expect(page.getByRole('heading', { name: 'Live stream control' })).toBeVisible()
    await expect(page.locator('body')).toContainText('Weekly live build')
    await expect(page.locator('body')).toContainText('128 watching')
    await expect(page.locator('body')).not.toContainText('Checking your live stream schedule...')
  })

  test('moderation page lists catalog categories and supports drag-and-drop assignment', async ({ page }) => {
    await mockAuthenticatedSession(page)
    await mockDashboardApis(page)
    await mockModerationApis(page)

    await page.goto('/dashboard')
    await page.getByRole('link', { name: 'Moderation Rules' }).click()
    await page.waitForURL('**/moderation')

    await expect(page.getByRole('heading', { name: 'Moderation Rules' })).toBeVisible()
    await expect(page.locator('body')).toContainText('Categories')
    await expect(page.locator('body')).toContainText('Ban Agent')
    await expect(page.locator('body')).toContainText('Timeout Agent')
    await expect(page.locator('body')).toContainText('Every category is listed below.')

    const catalogSection = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Categories' }) })
    const timeoutSection = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Timeout Agent' }) })
    const banSection = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Ban Agent' }) })

    await expect(catalogSection).toContainText('Harassment')
    await expect(banSection).toContainText('Scam Links')
    await expect(timeoutSection).toContainText('Repeated Spam')

    await catalogSection.locator('article').filter({ hasText: 'Harassment' }).first().dragTo(timeoutSection.locator('article').first())
    await expect(timeoutSection).toContainText('Harassment')
    await expect(catalogSection).not.toContainText('Harassment')

    await banSection.locator('article').filter({ hasText: 'Scam Links' }).first().dragTo(catalogSection.getByText('Nothing here yet'))
    await expect(catalogSection).toContainText('Scam Links')
    await expect(banSection).not.toContainText('Scam Links')
  })

  test('qna and moderation agent switches repaint after settings updates', async ({ page }) => {
    await mockAuthenticatedSession(page)
    await mockDashboardApis(page)
    await mockModerationApis(page)
    await mockQnaApis(page)
    await mockChannelSettingsApi(page)

    await page.goto('/qna')
    await expect(page.getByRole('switch', { name: 'Enabled' })).toBeVisible()
    await page.getByRole('switch', { name: 'Enabled' }).click()
    const qnaSwitch = page.getByRole('switch', { name: 'Paused' })
    await expect(qnaSwitch).toBeVisible()
    await expect(qnaSwitch).toHaveAttribute('aria-checked', 'false')
    await expect(qnaSwitch).toHaveClass(/status-toggle-off/)
    await expect(qnaSwitch.locator('.status-toggle-track')).toHaveClass(/status-toggle-track-off/)
    await expect(qnaSwitch.locator('.status-toggle-thumb')).toHaveClass(/status-toggle-thumb-off/)

    await page.getByRole('link', { name: 'Moderation Rules' }).click()
    await page.waitForURL('**/moderation')
    await expect(page.getByRole('switch', { name: 'Enabled' })).toBeVisible()
    await page.getByRole('switch', { name: 'Enabled' }).click()
    const moderationSwitch = page.getByRole('switch', { name: 'Paused' })
    await expect(moderationSwitch).toBeVisible()
    await expect(moderationSwitch).toHaveAttribute('aria-checked', 'false')
    await expect(moderationSwitch).toHaveClass(/status-toggle-off/)
    await expect(moderationSwitch.locator('.status-toggle-track')).toHaveClass(/status-toggle-track-off/)
    await expect(moderationSwitch.locator('.status-toggle-thumb')).toHaveClass(/status-toggle-thumb-off/)
  })

  test('dashboard stream load and moderation runtime controls repaint without navigation', async ({ page }) => {
    await mockAuthenticatedSession(page)
    await mockDashboardApis(page)

    await page.goto('/dashboard')

    await expect(page.getByRole('heading', { name: 'Live stream control' })).toBeVisible()
    await expect(page.locator('body')).toContainText('Weekly live build')
    await expect(page.locator('body')).not.toContainText('Checking your live stream schedule...')

    await page.getByRole('button', { name: 'Start Moderation' }).click()
    await expect(page.getByRole('button', { name: 'Stop Moderation' })).toBeVisible()
    await expect(page.locator('body')).toContainText('Running since')

    await page.getByRole('button', { name: 'Stop Moderation' }).click()
    await expect(page.getByRole('button', { name: 'Start Moderation' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Stop Moderation' })).toHaveCount(0)
  })
})
