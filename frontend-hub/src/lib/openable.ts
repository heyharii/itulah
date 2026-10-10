/// A row or card that opens something, reachable without a mouse.
///
/// It was a click handler on a `<tr>` and nothing else, so the only way to
/// open a record from the keyboard was not to have one. Now each openable row
/// is a tab stop: Enter or Space opens it, and the arrow keys walk to the row
/// above or below — forty tabs to reach the fortieth supplier is not a way to
/// read a list. A key pressed on a control INSIDE the row (the verb in the
/// status cell, a checkbox) is that control's, and is left alone.
///
/// Shared by the table's rows and by the phone cards (`phone-cards.tsx`),
/// which are the same rows laid out as cards.
export function openable(open: () => void) {
  return {
    tabIndex: 0,
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.target !== event.currentTarget) return
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault()
        open()
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        // Past an expanded row's extra block, which is not a tab stop.
        let next =
          event.key === "ArrowDown"
            ? event.currentTarget.nextElementSibling
            : event.currentTarget.previousElementSibling
        while (
          next instanceof HTMLElement &&
          next.tabIndex !== 0 &&
          next.hasAttribute("data-sub")
        ) {
          next =
            event.key === "ArrowDown"
              ? next.nextElementSibling
              : next.previousElementSibling
        }
        if (next instanceof HTMLElement && next.tabIndex === 0) {
          event.preventDefault()
          next.focus()
        }
      }
    },
  }
}

/// The ring an openable row wears under the keyboard — inset, because a row
/// is flush with its neighbours and an outset ring is cut off by them.
export const FOCUSED =
  "outline-none focus-visible:bg-accent-bg/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
