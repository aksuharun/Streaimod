const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1'])

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

export function resolveBackendOrigin(): string {
  const configuredOrigin = import.meta.env.VITE_BACKEND_ORIGIN?.trim()

  if (configuredOrigin) {
    return trimTrailingSlash(configuredOrigin)
  }

  const { protocol, hostname, port, origin } = window.location

  if (LOCAL_HOSTNAMES.has(hostname) && port !== '3000') {
    return `${protocol}//${hostname}:3000`
  }

  return origin
}

export function buildBackendUrl(path: string): string {
  if (/^https?:\/\//.test(path)) {
    return path
  }

  return new URL(path, `${resolveBackendOrigin()}/`).toString()
}
