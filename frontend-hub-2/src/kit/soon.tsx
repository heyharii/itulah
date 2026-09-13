/// A screen that is declared but not written yet.
///
/// Deliberately a real screen rather than a missing route. A module whose
/// sidebar is half the length it will end up being teaches the wrong shape;
/// this says what is coming and, more usefully, says plainly that it is not
/// here — which a blank page does not.
export function Soon({ name }: { name: string }) {
  return (
    <div className="grid flex-1 place-items-center p-10 text-center">
      <div>
        <div className="text-metric font-semibold">{name}</div>
        <p className="text-ctl text-ink-3 mt-1">
          Not written in this app yet. The old screen is still running in the
          hub.
        </p>
      </div>
    </div>
  )
}
