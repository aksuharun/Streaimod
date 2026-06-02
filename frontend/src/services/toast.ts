import { ToastStore } from '@geajs/ui'

type ToastOptions = Parameters<typeof ToastStore.create>[0]
type TypedToastOptions = Omit<ToastOptions, 'type'>

const MAX_VISIBLE = 2

function replaceToast<T>(show: () => T): T {
  const store = ToastStore.getStore()
  const visible = store.getVisibleToasts()

  // When the visible stack is already full, clear it before adding the new
  // toast. Removing one toast by id lets Zag immediately promote any queued
  // stale toast, which can make the newest notification wait.
  if (visible.length >= MAX_VISIBLE) {
    store.remove()
  }

  return show()
}

export function showToast(options: ToastOptions) {
  return replaceToast(() => ToastStore.create(options))
}

export function showSuccessToast(options: TypedToastOptions) {
  return replaceToast(() => ToastStore.success(options))
}

export function showErrorToast(options: TypedToastOptions) {
  return replaceToast(() => ToastStore.error(options))
}

export function showInfoToast(options: TypedToastOptions) {
  return replaceToast(() => ToastStore.info(options))
}

export function showLoadingToast(options: TypedToastOptions) {
  return replaceToast(() => ToastStore.loading(options))
}

export function clearToasts() {
  ToastStore.dismiss()
}
