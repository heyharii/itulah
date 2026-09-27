import { useEffect } from "react"

import { useGo } from "@/lib/go"
import { useParam } from "@/lib/params"

/// Where the count sheet used to be pushed.
///
/// The blind count is now a sheet over the bay itself — `HitungSheet`, in
/// `terima-sheets.tsx`, which carries its reasoning — so the list of lorries
/// stays under the thumb. This path is kept for the links, the bookmarks and
/// the reloads that still name it, and hands each one to the bay with the same
/// order's sheet open. `replace`, so back does not land here again.
export function TerimaHitung() {
  const go = useGo()
  const po = useParam("po").value

  useEffect(() => {
    go("/terima", { lihat: "hitung", po }, { replace: true })
  }, [go, po])

  return null
}
