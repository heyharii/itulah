/// The few pieces this module needs that `components/ui` does not have.
///
/// They live here rather than in `components/ui` because that directory is
/// shared and this module does not own it — see PATTERN.md. Nothing below
/// invents a token, a size or a colour: `Select` is `Input` with a caret, and
/// the rest are the row and cell of `<MiniTable>`, which the shared component
/// deliberately leaves to the caller.

/// Two lines in one cell: the thing, and the code it is known by underneath.
export function Named({
  name,
  code,
}: {
  name: React.ReactNode
  code?: React.ReactNode
}) {
  return (
    <>
      <span className="block text-[0.8125rem] text-ink">{name}</span>
      {code && (
        <span className="font-mono text-[0.65625rem] text-mute">{code}</span>
      )}
    </>
  )
}

/// A quiet sentence where a table would be, inside a sheet or a card.
///
/// Not `<EmptyState>`: that owns a whole card and 3.5rem of padding, which
/// inside a sheet tab reads as a broken panel rather than as an answer.
export function Quiet({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-meta text-body">{children}</p>
}

/// A live/paused switch.
///
/// Built here rather than in `components/ui` because this module is the only
/// one with something to switch — see PATTERN.md: a primitive lives in its
/// module until a second module wants it. It is a `role="switch"` button and
/// not a checkbox: what it changes is a *state of the world* that takes effect
/// when released, not a value inside a form somebody will submit later.
export function Switch({
  on,
  busy,
  label,
  onToggle,
}: {
  on: boolean
  busy?: boolean
  label: string
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={busy}
      onClick={(event) => {
        // The row underneath opens a detail; the switch changes the world.
        // Letting the click reach both would open a panel every time somebody
        // pauses something.
        event.stopPropagation()
        onToggle()
      }}
      className={`relative inline-flex h-[1.125rem] w-[1.875rem] shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
        on ? "bg-accent" : "bg-soft-3"
      }`}
    >
      <span
        className={`absolute size-3.5 rounded-full bg-canvas shadow-soft transition-[left] ${
          on ? "left-[0.875rem]" : "left-0.5"
        }`}
      />
    </button>
  )
}
