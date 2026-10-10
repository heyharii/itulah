import { useNavigate, useRouter } from "@tanstack/react-router"
import { useRef, useState } from "react"

import { useParam, type ParamKey, type Search } from "@/lib/params"

/// Which record's sheet is open over a list, held in the URL.
///
/// The catalogue's rule (`screens/catalogue.tsx`), written once for the Stock
/// screens. Opening pushes a history entry, so the phone's back gesture closes
/// the sheet instead of leaving the screen; closing goes back when the sheet was
/// opened here, and otherwise (a link, a reload) just drops the key. A reload
/// with the key in the address bar opens the same record again.
export function useOpenRecord(key: ParamKey) {
  const param = useParam(key)
  const navigate = useNavigate()
  const router = useRouter()
  const opened = useRef(false)

  return {
    /// The id of the record whose sheet is open, if any.
    value: param.value,
    open: (id: string) => {
      opened.current = true
      void navigate({
        to: ".",
        search: (previous: Search) => ({ ...previous, [key]: id }),
      })
    },
    close: () => {
      if (opened.current && router.history.canGoBack()) {
        opened.current = false
        router.history.back()
      } else param.set(undefined)
    },
  }
}

/// The record a sheet last showed, kept while the sheet slides away — closing
/// takes the id out of the URL at once, and a sheet that lost its record at that
/// moment would blank mid-travel.
export function useHeld<T>(value: T | undefined): T | undefined {
  const [held, setHeld] = useState<T | undefined>(undefined)
  if (value !== undefined && value !== held) setHeld(value)
  return value ?? held
}
