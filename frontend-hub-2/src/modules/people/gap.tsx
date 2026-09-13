/// A screen that is declared, and that nothing on the server can answer yet.
///
/// ## Why this is not `kit/soon.tsx`
///
/// `Soon` says "Not written in this app yet. The old screen is still running in
/// the hub", and for seven of this module's rows that is exactly true — Roster,
/// Period close, Pay agreements and the four rules screens all exist in
/// `frontend-hub` and are waiting to be rewritten here. For five of them it is
/// false in the way that matters: there is no old screen, because there is no
/// endpoint. Attendance has no punch source anywhere in the cloud; claims,
/// performance and recruitment have no tables at all.
///
/// Telling somebody their screen is merely un-ported, when in fact the data it
/// would read does not exist, sends them to the other app to look for it. So
/// the two placeholders say two different things, and this one names what is
/// missing — which is also the only honest way a nav row for an unbuildable
/// screen earns its place.
export function Gap({
  name,
  missing,
}: {
  name: string
  /// What is absent, in one sentence, in terms of the system rather than the
  /// roadmap: "there is no punch source", not "this is coming later".
  missing: React.ReactNode
}) {
  return (
    <div className="grid flex-1 place-items-center p-10 text-center">
      <div className="max-w-[34rem]">
        <div className="text-metric font-semibold">{name}</div>
        <p className="text-ctl text-ink-3 mt-1">{missing}</p>
        <p className="text-meta text-ink-4 mt-2">
          Nothing is hidden here and nothing failed to load. The row is in the
          menu so the shape of the module is honest about what it does not yet
          do.
        </p>
      </div>
    </div>
  )
}
