import { useSyncExternalStore } from "react"

/// One line of news after something was done — "Hitungan disimpan" — shown
/// for a moment above the tab bar by `<NoticeHost />` in the shell.
///
/// For what a person did on this phone, not for what the node thinks of it:
/// whether the work reached the node is the outbox's banner, which stays until
/// it is true. This only says the press landed, which on a sheet that has just
/// slid away is otherwise said by nothing.
export interface Notice {
  readonly id: number
  readonly text: string
  readonly tone: "ok" | "warn"
}

interface State {
  /// The last notice, kept while it fades out.
  readonly notice: Notice | null
  readonly shown: boolean
}

let state: State = { notice: null, shown: false }
let serial = 0
let timer: ReturnType<typeof setTimeout> | undefined
const listeners = new Set<() => void>()

function set(next: State) {
  state = next
  for (const listener of listeners) listener()
}

export function notice(text: string, tone: Notice["tone"] = "ok"): void {
  serial += 1
  set({ notice: { id: serial, text, tone }, shown: true })
  clearTimeout(timer)
  timer = setTimeout(() => set({ ...state, shown: false }), 2800)
}

export function useNotice(): State {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => state,
  )
}
