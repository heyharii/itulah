import { useEffect } from "react"

import { useGo } from "@/lib/go"
import { useParam } from "@/lib/params"

/// Where the verification used to be pushed.
///
/// The second pair of eyes is now a sheet over the bay — `PeriksaSheet`, in
/// `terima-sheets.tsx`, which carries its reasoning and the rule that nobody
/// verifies their own count. This path is kept for the links, the bookmarks and
/// the reloads that still name it, and hands each one to the bay with the same
/// order's sheet open. `replace`, so back does not land here again.
export function TerimaPeriksa() {
  const go = useGo()
  const po = useParam("po").value

  useEffect(() => {
    go("/terima", { lihat: "periksa", po }, { replace: true })
  }, [go, po])

  return null
}
