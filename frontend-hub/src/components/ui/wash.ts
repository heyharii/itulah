/// The washes a status sits on: a strip across a sheet, a pill beside a
/// store, an article row that differs. The tinted button's cousins
/// (`tint-button.tsx`): the same pale grounds, for things that are read and
/// not pressed.
///
/// Paler than the `-bg` tokens, which are for meters and charts, and written
/// as hex because white.css outlines a `span` drawn on the `-bg` tokens (a
/// small tag: "outlined, not filled").
///
/// Its own module, like `button-style.ts`, because a file that exports both a
/// component and a value loses fast refresh.
export const WASH = {
  warn: "bg-[#fdf5e8] text-warn-fg",
  bad: "bg-[#fdf0f1] text-bad-fg",
  ok: "bg-[#eaf6ee] text-ok-fg",
  info: "bg-accent-bg text-accent",
  neutral: "bg-soft-2 text-body",
} as const

export type WashTone = keyof typeof WASH
