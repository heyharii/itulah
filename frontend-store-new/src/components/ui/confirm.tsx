import { AlertDialog } from "@base-ui/react/alert-dialog"
import { useRef, useSyncExternalStore } from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/// A question that needs a yes before something is sent — `window.confirm`
/// in the app's own look, set up the way `toast()` is: call `confirm()` from
/// anywhere, mount `<Confirms />` once (App.tsx, beside `<Toasts />`).
///
///   if (await confirm({ title: "Send to HO?", action: "Send 4 pcs" })) send()
///
/// Resolves `true` on the primary action, `false` on Cancel, Escape or a press
/// outside. The `action` label names the act ("Send 4 pcs", "Submit count"),
/// never "OK". `destructive` paints it red, for what cannot be taken back.
/// Focus lands on the primary button, so Enter says yes.
export interface ConfirmAsk {
  title: string
  /// One short line under the title.
  body?: string
  action: string
  destructive?: boolean
}

interface Pending extends ConfirmAsk {
  resolve: (ok: boolean) => void
}

let pending: Pending | null = null
const listeners = new Set<() => void>()

function set(next: Pending | null) {
  pending = next
  listeners.forEach((listener) => listener())
}

export function confirm(ask: ConfirmAsk): Promise<boolean> {
  // A second question while one is open answers the first with a no.
  pending?.resolve(false)
  return new Promise((resolve) => set({ ...ask, resolve }))
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function Confirms() {
  const ask = useSyncExternalStore(subscribe, () => pending)
  // Kept after it closes so the card does not empty while it fades out.
  const last = useRef<Pending | null>(null)
  if (ask !== null) last.current = ask
  const shown = ask ?? last.current

  function answer(ok: boolean) {
    if (pending === null) return
    pending.resolve(ok)
    set(null)
  }

  return (
    <AlertDialog.Root
      open={ask !== null}
      onOpenChange={(open) => {
        if (!open) answer(false)
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="sheet-veil fixed inset-0 z-50 bg-[var(--scrim)] transition-opacity duration-(--t-sheet) ease-(--ease-out) data-[ending-style]:opacity-0 data-[ending-style]:duration-(--t-exit) data-[starting-style]:opacity-0" />
        <AlertDialog.Viewport className="fixed inset-0 z-50 flex items-end justify-center p-3 md:items-center md:p-5">
          <AlertDialog.Popup
            initialFocus={() =>
              document.querySelector<HTMLElement>("[data-confirm-primary]")
            }
            className="flex w-full max-w-[26rem] flex-col gap-4 rounded-card border border-hairline bg-canvas p-5 shadow-pop transition-[opacity,scale] duration-(--t-sheet) ease-(--ease-out) data-[ending-style]:scale-[0.97] data-[ending-style]:opacity-0 data-[ending-style]:duration-(--t-exit) data-[starting-style]:scale-[0.97] data-[starting-style]:opacity-0"
          >
            <div className="flex flex-col gap-1">
              <AlertDialog.Title className="text-[1rem] leading-6 font-semibold tracking-[-0.01em] text-ink">
                {shown?.title}
              </AlertDialog.Title>
              {shown?.body !== undefined && (
                <AlertDialog.Description className="text-[0.9375rem] text-body">
                  {shown.body}
                </AlertDialog.Description>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="soft" onClick={() => answer(false)}>
                Cancel
              </Button>
              <Button
                data-confirm-primary=""
                variant="primary"
                className={cn(
                  shown?.destructive === true &&
                    "bg-bad text-on-dark hover:bg-bad hover:brightness-95",
                )}
                onClick={() => answer(true)}
              >
                {shown?.action}
              </Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Viewport>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
