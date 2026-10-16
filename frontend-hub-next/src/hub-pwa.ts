/// Browser capabilities intentionally left out of this server-rendered demo.
/// Keeping these small hooks lets the shared session module run without the
/// Vite-only service-worker virtual module used by the full Hub app.
export interface Installability {
  readonly canInstall: boolean
  readonly installed: boolean
  install(): Promise<boolean>
}

export function registerServiceWorker(): void {}

export function onWorkerMessage(
  _handler: (message: { type: string; url?: string }) => void
): () => void {
  return () => {}
}

export function isStandalone(): boolean {
  return typeof window !== "undefined" &&
    window.matchMedia?.("(display-mode: standalone)").matches === true
}

export function isIos(): boolean {
  if (typeof navigator === "undefined") return false
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
}

export function useInstall(): Installability {
  return { canInstall: false, installed: isStandalone(), install: async () => false }
}
