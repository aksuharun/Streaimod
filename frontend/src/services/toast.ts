export type ToastTone = 'success' | 'error' | 'info' | 'loading'

export interface ToastOptions {
  title: string
  description?: string
}

export interface ToastItem extends ToastOptions {
  id: string
  tone: ToastTone
}

const MAX_VISIBLE = 2
const DEFAULT_DURATION_MS = 4000
const listeners = new Set<() => void>()
let toasts: ToastItem[] = []

function emit() {
  for (const listener of listeners) {
    listener()
  }
}

function createToastId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function enqueueToast(tone: ToastTone, options: ToastOptions) {
  const toast: ToastItem = {
    id: createToastId(),
    tone,
    title: options.title,
    description: options.description
  }

  toasts = [...toasts.slice(-(MAX_VISIBLE - 1)), toast]
  emit()

  if (tone !== 'loading') {
    window.setTimeout(() => {
      dismissToast(toast.id)
    }, DEFAULT_DURATION_MS)
  }

  return toast.id
}

export function subscribeToasts(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getToasts() {
  return toasts
}

export function dismissToast(id: string) {
  const next = toasts.filter((toast) => toast.id !== id)
  if (next.length === toasts.length) {
    return
  }

  toasts = next
  emit()
}

export function clearToasts() {
  if (toasts.length === 0) {
    return
  }

  toasts = []
  emit()
}

export function showToast(options: ToastOptions & { tone?: ToastTone }) {
  return enqueueToast(options.tone ?? 'info', options)
}

export function showSuccessToast(options: ToastOptions) {
  return enqueueToast('success', options)
}

export function showErrorToast(options: ToastOptions) {
  return enqueueToast('error', options)
}

export function showInfoToast(options: ToastOptions) {
  return enqueueToast('info', options)
}

export function showLoadingToast(options: ToastOptions) {
  return enqueueToast('loading', options)
}
