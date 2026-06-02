export const REQUIRED_PROMPT_ENV_NAMES = [
  'RAISON_QNA_PROMPT_ID',
  'RAISON_NORMALIZE_PROMPT_ID',
  'RAISON_BAN_PROMPT_ID',
  'RAISON_TIMEOUT_PROMPT_ID'
] as const

export const REQUIRED_AUTH_ENV_NAMES = [
  'YOUTUBE_CLIENT_ID',
  'YOUTUBE_CLIENT_SECRET',
  'GOOGLE_REDIRECT_URI',
  'SESSION_SECRET',
  'AUTH_TOKEN_ENCRYPTION_KEY'
] as const

export const REQUIRED_BACKEND_STARTUP_ENV_NAMES = [
  ...REQUIRED_PROMPT_ENV_NAMES
] as const

export function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim()

  if (!value) {
    throw new Error(`${name} is required`)
  }

  return value
}

export function getOptionalEnv(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback
}

export function assertRequiredEnv(names: readonly string[]): void {
  for (const name of names) {
    getRequiredEnv(name)
  }
}

export function runBackendStartupPreflight(): void {
  assertRequiredEnv(REQUIRED_BACKEND_STARTUP_ENV_NAMES)
}
