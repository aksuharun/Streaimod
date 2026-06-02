export async function withTemporaryEnv<T>(
  updates: Record<string, string | undefined>,
  run: () => Promise<T>
): Promise<T> {
  const original: Record<string, string | undefined> = {}

  for (const [key, value] of Object.entries(updates)) {
    original[key] = process.env[key]

    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  try {
    return await run()
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}
