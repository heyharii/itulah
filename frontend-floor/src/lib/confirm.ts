import { useSyncExternalStore } from "react"

/// One question before something that cannot be taken back, asked in the same
/// sheet every picker here opens rather than in `window.confirm`.
///
/// The browser's dialog is the platform's: a grey system box on Android, a
/// centred alert on iOS, both printing the page's address above the question
/// and neither within reach of a thumb at the foot of the glass. This rises from
/// the bottom, swipes away as a "no", and puts the two answers where the thumb
/// already is.
///
/// Called like the dialog it replaces, but awaited:
///
/// ```ts
/// if (!(await confirm({ title: "Buang tally ronde ini?" }))) return
/// ```
///
/// `<ConfirmHost />` (components/ui/confirm.tsx) is mounted once, in the shell
/// and draws whatever is asked here.
export interface Question {
  readonly title: string
  /// What happens, in a sentence, when the title alone does not say it.
  readonly body?: string
  /// The word on the button that goes ahead. "Ya" says nothing about what.
  readonly yes?: string
  readonly no?: string
  /// Whether going ahead loses something.
  readonly danger?: boolean
}

interface State {
  readonly open: boolean
  /// Kept after the answer so the sheet still has words while it slides away.
  readonly question: Question | null
}

let state: State = { open: false, question: null }
let answer: ((yes: boolean) => void) | null = null
const listeners = new Set<() => void>()

export function settle(yes: boolean) {
  const resolve = answer
  answer = null
  state = { ...state, open: false }
  for (const listener of listeners) listener()
  resolve?.(yes)
}

export function confirm(question: Question): Promise<boolean> {
  // A second question while one is open answers the first "no" — two stacked
  // sheets asking two things is never what anybody meant.
  if (answer !== null) settle(false)
  return new Promise((resolve) => {
    answer = resolve
    state = { open: true, question }
    for (const listener of listeners) listener()
  })
}

/// The question being asked, for `<ConfirmHost />`.
export function useQuestion(): State {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => state,
  )
}

/// Whether anybody is still waiting on an answer — a sheet dismissed after it
/// has already been answered is not a second "no".
export function asking(): boolean {
  return answer !== null
}
