import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    clearMocks: true,
    coverage: {
      exclude: [
        '**/*.d.ts',
        'coverage/**',
        'dist/**',
        'node_modules/**',
        'src/server.ts',
        'tests/**',
        'vitest.config.ts'
      ],
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: 'coverage',
      thresholds: {
        branches: 75,
        functions: 80,
        lines: 80,
        statements: 80
      }
    },
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    restoreMocks: true,
    setupFiles: ['./tests/setup.ts']
  }
})
