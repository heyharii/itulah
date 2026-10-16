/// The first paint, as React draws it.
///
/// `index.html` carries the same markup inline so that a shop line sees the
/// shell's shape before one byte of script arrives; React replaces it on its
/// first render, and this component exists so that the replacement is the SAME
/// PICTURE. What used to stand here was a centred brand mark (`Launch`) — a
/// loading screen that appeared for as long as `/auth/me` took, which is
/// exactly the wait the skeleton had already covered with something that is
/// not a spinner and not a logo: the app's own silhouette.
///
/// Styling lives in `index.html`'s inline `<style>` block, which is still in
/// the document and matches these class names. **Keep the two in step**: the
/// markup here and the markup there are the same screen, one drawn by the
/// parser and one by React.
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
