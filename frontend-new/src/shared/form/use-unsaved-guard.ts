/**
 * Stops a half-typed form from vanishing.
 *
 * Two sheets in the app hand-rolled a `dirty` flag for this. That flag only
 * ever covered the sheet's own close button — navigate with the app rail, hit
 * Back, close the tab, or reload, and the draft went anyway.
 *
 * `useBlocker` covers route navigation, and `enableBeforeUnload` covers the
 * browser's own reload and tab-close. One hook, the three ways a draft actually
 * gets lost.
 */

import { useBlocker } from "@tanstack/react-router"

export interface UnsavedGuardOptions {
  /** Whether there is anything worth warning about. */
  when: boolean
  /**
   * Asked before leaving. Return `true` to stay put.
   *
   * Defaults to `window.confirm`. A sheet with its own discard affordance
   * should pass its own — the app already has that pattern in the forum's new
   * topic sheet, and a native dialog beside a designed one reads as a bug.
   */
  confirm?: () => boolean | Promise<boolean>
}

const askNatively = () =>
  !window.confirm("Discard your unsaved changes?")

/**
 * @example
 * const form = useAppForm({ … })
 * const isDirty = useStore(form.store, (state) => state.isDirty)
 * useUnsavedGuard({ when: isDirty })
 */
export function useUnsavedGuard({ when, confirm }: UnsavedGuardOptions) {
  useBlocker({
    /* Returning `true` blocks. The default asks, and treats "cancel" as
     * "stay" — the safe direction, because the cost of a spurious block is a
     * second click and the cost of a spurious pass is the user's typing. */
    shouldBlockFn: () => (when ? (confirm ?? askNatively)() : false),
    /* The same guard for a reload or a tab close. The browser shows its own
     * wording here — that is not ours to choose, and it is still better than
     * losing the draft silently. */
    enableBeforeUnload: () => when,
  })
}
