/// The few pieces this module needs that `components/ui` does not have.
///
/// `<Switch>` used to live here and is now in `components/ui/form`: it was
/// promoted the moment a second module wanted something to switch.
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
      <span className="block text-[0.9375rem] text-ink">{name}</span>
      {code && (
        <span className="font-mono text-[0.9375rem] text-mute">{code}</span>
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
