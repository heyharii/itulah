/// The few pieces this module needs that `components/ui` does not have.
///
/// `Select` is `<Input>` with a caret, and the two mini-table helpers are the
/// row and cell that `<MiniTable>` deliberately leaves to the caller. They live
/// here rather than in `components/ui` because that directory is shared and
/// this module does not own it — see PATTERN.md. Nothing below invents a token,
/// a size or a colour.

/// A quiet sentence where a table would be, inside a sheet or a card.
///
/// Not `<EmptyState>`: that owns a whole card and 3.5rem of padding, which
/// inside a sheet tab reads as a broken panel rather than as an answer.
export function Quiet({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-meta text-body">{children}</p>
}
