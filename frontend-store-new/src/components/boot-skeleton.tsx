/// The first paint, as React draws it.
///
/// `index.html` carries the same markup inline so a counter's line sees the
/// shell's shape before one byte of script arrives — the rail the app will
/// have, the panel beside it, the rows a screen draws — and React replaces it
/// on its first render with the SAME PICTURE. What stood here before was the
/// brand mark centred on white (`Launch`): a loading screen that appeared for
/// as long as `/auth/me` took, on a counter where that is the wait nobody
/// should watch (owner, 2026-10-10: "hapus loading yang nampilin logo, kita
/// maunya instant").
///
/// Styling lives in `index.html`'s inline `<style>` block, which stays in the
/// document and matches these class names. **Keep the two in step**: one
/// screen, drawn by the parser and by React.
export function BootSkeleton() {
  return (
    <div id="boot" aria-hidden="true">
      <div className="b-rail">
        <div className="b-mark" />
        <div className="b-dot" />
        <div className="b-dot" />
        <div className="b-dot" />
        <div className="b-dot" />
      </div>
      <div className="b-panel">
        <div className="b-label" />
        <div className="b-row" />
        <div className="b-row" style={{ width: "78%" }} />
        <div className="b-row" style={{ width: "86%" }} />
        <div className="b-row" style={{ width: "70%" }} />
      </div>
      <div className="b-body">
        <div className="b-head" />
        <div className="b-cell" />
        <div className="b-cell" />
        <div className="b-cell" />
        <div className="b-cell" />
        <div className="b-cell" />
      </div>
    </div>
  )
}
