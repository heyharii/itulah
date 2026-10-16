/// Print one piece of the page, on its own sheet of paper.
///
/// The piece is copied into a frame of its own and the frame is printed, rather
/// than the page being printed with everything else hidden: a record sheet is a
/// fixed, clipped box over the page, and "hide the rest" prints only the part of
/// the paper that fits inside it. The copy carries its own `<style>` — the
/// papers are drawn in plain CSS (`kp-` classes) for exactly this reason, since
/// the page's utility classes do not exist in the frame.
export function printNode(node: HTMLElement, title: string): void {
  const frame = document.createElement("iframe")
  frame.setAttribute("aria-hidden", "true")
  frame.tabIndex = -1
  Object.assign(frame.style, {
    position: "fixed",
    right: "0",
    bottom: "0",
    width: "0",
    height: "0",
    border: "0",
  })

  const remove = () => frame.remove()
  frame.onload = () => {
    const view = frame.contentWindow
    if (view === null) {
      remove()
      return
    }
    view.addEventListener("afterprint", remove)
    view.focus()
    view.print()
    // A dialog dismissed in a browser that never says so.
    window.setTimeout(remove, 120_000)
  }

  const safe = title.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)
  frame.srcdoc =
    `<!doctype html><html><head><meta charset="utf-8"><title>${safe}</title>` +
    `<style>html,body{margin:0;padding:0;background:#fff}</style></head>` +
    `<body>${node.outerHTML}</body></html>`
  document.body.appendChild(frame)
}
