import { useLayoutEffect, useRef } from "react"

/// The ref a table wears so it can stack on a phone.
///
/// Below 48rem a table carrying the `mini-stack` class is laid out as blocks
/// (styles/index.css): each row's first cell across the top, every other cell
/// under the name of its column. The names come from here — copied from the
/// head onto each cell as `data-label`, by column position (a cell spanning
/// several columns gets none and spans the block) — so no screen has to say,
/// cell by cell, which column it is in. Relabelled whenever rows are added or
/// replaced; writing a data attribute is not a child-list change, so the
/// observer does not wake itself.
export function useStackLabels() {
  const table = useRef<HTMLTableElement>(null)
  useLayoutEffect(() => {
    const node = table.current
    if (node === null) return
    const label = () => {
      const heads = Array.from(node.tHead?.rows[0]?.cells ?? []).map(
        (cell) => cell.textContent?.trim() ?? ""
      )
      for (const body of Array.from(node.tBodies)) {
        for (const row of Array.from(body.rows)) {
          let column = 0
          for (const cell of Array.from(row.cells)) {
            const span = cell.colSpan || 1
            const name = span === 1 ? heads[column] : ""
            if (name) cell.dataset.label = name
            else delete cell.dataset.label
            column += span
          }
        }
      }
    }
    label()
    const watch = new MutationObserver(label)
    watch.observe(node, { childList: true, subtree: true })
    return () => watch.disconnect()
  }, [])
  return table
}
