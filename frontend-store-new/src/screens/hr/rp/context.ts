import { createContext, useContext } from "react"

/// What a page inside `<RpFrame>` may ask of it.
export interface RpApi {
  /// A line at the foot of the page; `undo` puts an Undo button on it.
  readonly toast: (text: string, undo?: () => void) => void
}

export const RpContext = createContext<RpApi | null>(null)

export function useRp(): RpApi {
  const api = useContext(RpContext)
  if (api === null) throw new Error("useRp outside <RpFrame>")
  return api
}
