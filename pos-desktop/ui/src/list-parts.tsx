/// The parts the list modes share — Tunda, Struk and Cek turn the item list
/// itself into a list (client, 25 Oct 2026: "kurangi sheet"), so they are drawn
/// with the sale list's own classes (`till-d.css`, under `.tilld`).

import type { MouseEvent, ReactNode } from "react"

import { money } from "@itulah/contract/money"

/// "Rp 1.122.000" → ["Rp", "1.122.000"]: the footer draws the currency small
/// beside the big figure, and a grid shows the figure alone.
export function figureOf(minor: number, currency: string): readonly [string, string] {
  const text = money(minor, currency).replace(/\s/g, " ")
  const at = text.search(/\d/)
  return at <= 0 ? ["", text] : [text.slice(0, at).trim(), text.slice(at)]
}

/// A figure that means money, read on its own: "Rp 1.122.000". Every place
/// that shows an amount says Rp (Hari, 30 Oct 2026); a layout that draws the
/// currency small beside the number uses `figureOf` and takes its second part.
export const plain = (minor: number, currency: string) => money(minor, currency)

const two = (n: number) => String(n).padStart(2, "0")
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]

/// "10:52".
export const clock = (at: Date) => `${two(at.getHours())}:${two(at.getMinutes())}`

/// "21 Okt · 10:52".
export const dayClock = (at: Date) => `${at.getDate()} ${MONTHS[at.getMonth()]} · ${clock(at)}`

/// A click on a row must not take the caret away from the scan field or the
/// search box: Enter and Esc keep meaning what the list says they mean.
export const keepCaret = (event: MouseEvent) => event.preventDefault()

/// A button of the floating foot. `main` is the big one that Enter presses;
/// every action is solid — blue, or red for what takes something away. The
/// small ones keep their word as bare text: at 1024 the sale list folds the
/// words of every `.t-big` button into its icon.
export function Act({
  label,
  tone = "primary",
  main = false,
  disabled = false,
  onClick,
}: {
  label: string
  tone?: "primary" | "bad"
  main?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`ds-btn ${tone === "bad" ? "ds-btn--destructive" : "ds-btn--primary"} ${main ? "t-pay" : "t-big"}`}
      disabled={disabled}
      onClick={onClick}
    >
      {main ? (
        <>
          <span>{label}</span>
          <span className="kbd">Enter</span>
        </>
      ) : (
        label
      )}
    </button>
  )
}

/// The foot of a list mode (`.t-float`): the way back at the left, then — when
/// there is one — what the list is about, in figures, and its acts.
export function ListFoot({
  back,
  onBack,
  label,
  minor,
  currency,
  children,
}: {
  back: string
  onBack: () => void
  /// Over the figure: "Tunda · 8 pcs".
  label?: string
  minor?: number
  currency: string
  children?: ReactNode
}) {
  const figure = minor === undefined ? null : figureOf(minor, currency)
  return (
    <div className="t-float">
      <button type="button" className="ds-btn ds-btn--primary t-big" onClick={onBack}>
        {back}
        <span className="kbd">Esc</span>
      </button>
      <span className="sp" />
      {figure !== null && (
        <div className="tf-total">
          <span className="tf-k">{label}</span>
          <span className="tf-v">
            <span className="cur">{figure[0]}</span>
            <b>{figure[1]}</b>
          </span>
        </div>
      )}
      {children}
    </div>
  )
}
