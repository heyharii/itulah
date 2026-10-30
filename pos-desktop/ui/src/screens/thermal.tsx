import type { ReactNode } from "react"
import { createPortal } from "react-dom"

import { printTextHere } from "@/edge"
import { useReceiptHeaderImage } from "@/receipt-header"
import "@/shift-d.css"

/// The 80 mm thermal papers the cash screens print (Tutup kasir, Tambah modal,
/// Setor modal, Setoran sementara) — pos-thermal-prototype.html, line for line.
/// One markup serves the preview on the screen and the copy for the printer:
/// the preview draws it in a `.thermal` sheet, the printer gets it in a
/// `.th-print` portal (rules: `shift-d.css` for the look, `pos.css` for paper).

/// The IDR figure the way the paper prints it: `Rp 5.200.000`. Every figure
/// that means money says Rp (Hari, 30 Oct 2026).
export const fmt = (n: number) => `${n < 0 ? "-" : ""}Rp ${Math.abs(n).toLocaleString("id-ID")}`

const two = (n: number) => String(n).padStart(2, "0")
/// `28/10/26`
export const dmy = (at: Date) => `${two(at.getDate())}/${two(at.getMonth() + 1)}/${String(at.getFullYear()).slice(2)}`
/// `14:12`
export const hm = (at: Date) => `${two(at.getHours())}:${two(at.getMinutes())}`
/// `28/10/2026 14:12`, the cut label's stamp.
export const dmyFull = (at: Date) => `${two(at.getDate())}/${two(at.getMonth() + 1)}/${at.getFullYear()} ${hm(at)}`

/// The shop as the client's own paper heads it: a logo band, then the address
/// lines head office keeps for the shop.
export type Shop = {
  readonly name: string
  readonly lines: readonly string[]
}

/// The band reads "CENTRAL", then the shop's own name in italics; when a node
/// does not say it, the house line.
const HOUSE = "Fashion Store"

/// Reads the shop header off whatever the node answered with (a shift report, a
/// slip's reply): `shop_name`, `shop_line_1`, `shop_line_2`. A node that does
/// not say yet gets the band alone — no address is made up.
export function shopOf(source: unknown): Shop {
  const root = source !== null && typeof source === "object" ? (source as Record<string, unknown>) : {}
  const text = (key: string): string | null => {
    const value = root[key]
    return typeof value === "string" && value.trim() !== "" ? value.trim() : null
  }
  return {
    name: text("shop_name") ?? HOUSE,
    lines: [text("shop_line_1"), text("shop_line_2")].filter((one): one is string => one !== null),
  }
}

export function ShopHead({ shop }: { shop: Shop }) {
  // The store's own picture, when head office gave it one, in place of the
  // words (Hari, 30 Oct 2026).
  const picture = useReceiptHeaderImage()
  if (picture !== null) {
    return (
      <>
        <img className="th-pic" src={picture} alt="" style={{ display: "block", width: "100%" }} />
        <hr />
      </>
    )
  }
  return (
    <>
      <div className="th-logo">
        <b>CENTRAL</b>
        <i>{shop.name}</i>
      </div>
      {shop.lines.map((line) => (
        <p className="th-c" key={line}>
          {line}
        </p>
      ))}
      <hr />
    </>
  )
}

/// One line of the paper: a word on the left, a figure on the right.
export function Row({ k, v, bold = false, mute = false }: { k: string; v: string; bold?: boolean; mute?: boolean }) {
  return (
    <p className={`th-r${bold ? " th-b" : ""}${mute ? " th-mute" : ""}`}>
      <span>{k}</span>
      <span>{v}</span>
    </p>
  )
}

/// The notes counted, largest first, only those there are: `  100.000 x  52 | 5.200.000`.
export function Denoms({ lines }: { lines: readonly { readonly value: number; readonly pieces: number }[] }) {
  return (
    <>
      {lines
        .filter((one) => one.pieces > 0)
        .map((one) => (
          <Row
            key={one.value}
            k={`${fmt(one.value).padStart(7)} x ${String(one.pieces).padStart(3)}`}
            v={fmt(one.value * one.pieces)}
          />
        ))}
    </>
  )
}

/// Two signature columns, a line to sign on over each name.
export function Signs({ left, right }: { left: readonly [string, string]; right: readonly [string, string] }) {
  return (
    <div className="th-sign">
      {[left, right].map(([word, name]) => (
        <div key={word}>
          {word}
          <span className="line" />
          {name === "" ? " " : name}
        </div>
      ))}
    </div>
  )
}

/// A cash slip: MODAL AWAL, TAMBAH MODAL KASIR, SETOR MODAL, SETORAN SEMENTARA.
/// `denoms` is the count a setoran lists above its total.
export function CashSlipPaper({
  shop,
  title,
  no,
  at,
  cashier,
  code,
  amount,
  denoms,
  from,
  to,
}: {
  shop: Shop
  title: string
  /// Null when the node numbers no slip for it (MODAL AWAL): no "No." row.
  no: string | null
  at: Date
  cashier: string
  code: string
  amount: number | null
  denoms?: readonly { readonly value: number; readonly pieces: number }[]
  from: string
  to: string
}) {
  return (
    <>
      <ShopHead shop={shop} />
      <p className="th-c th-b">{title}</p>
      <hr />
      {no !== null && <Row k="No." v={no} />}
      <Row k={dmy(at)} v={hm(at)} />
      <Row k="Kasir" v={`${cashier.toUpperCase()} ${code}`.trim()} />
      <hr />
      {denoms !== undefined && denoms.some((one) => one.pieces > 0) && (
        <>
          <Denoms lines={denoms} />
          <hr />
        </>
      )}
      <Row k="Jumlah" v={amount !== null ? fmt(amount) : "____________"} bold />
      <Signs left={["Diserahkan", from]} right={["Diterima", to]} />
    </>
  )
}

/// One piece per denomination counted, cut straight by the printer and taped
/// to its bundle: who, when, how many, how much — and nothing else.
export function CutLabels({
  who,
  at,
  lines,
}: {
  who: string
  at: Date
  lines: readonly { readonly value: number; readonly pieces: number }[]
}) {
  const counted = lines.filter((one) => one.pieces > 0)
  if (counted.length === 0) return null
  return (
    <div className="th-cuts">
      {counted.map((one) => (
        <div className="th-cut" key={one.value}>
          <p className="th-lab-k">{who}</p>
          <p className="th-lab-k">{dmyFull(at)}</p>
          <p className="th-lab-v th-sm">
            {one.pieces} x {fmt(one.value)}
          </p>
          <p className="th-lab-v">{fmt(one.value * one.pieces)}</p>
        </div>
      ))}
    </div>
  )
}

/// The paper as the cashier reads it on the screen.
export function ThermalSheet({ children }: { children: ReactNode }) {
  return (
    <div className="th-wrap">
      <div className="thermal">{children}</div>
    </div>
  )
}

/// The same paper for the printer: the paper first, then its cut labels, each
/// label ending in a page break so the printer cuts after it.
export function PrintCopy({ paper, labels }: { paper: ReactNode; labels?: ReactNode }) {
  return createPortal(
    <div className="th-print" aria-hidden="true">
      <div className="th-paper">{paper}</div>
      {labels}
    </div>,
    document.body,
  )
}

/// The paper on the screen as monospaced text, `cols` characters wide: a word
/// left and a figure right on one line, centred lines centred, a rule as
/// dashes. The cut labels are not part of it.
function slipText(cols: number): string {
  const paper = document.querySelector(".th-print .th-paper")
  if (paper === null) return ""
  const out: string[] = []
  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      const tag = child.tagName.toLowerCase()
      if (tag === "hr") out.push("-".repeat(cols))
      else if (tag === "p" && child.classList.contains("th-r")) {
        const parts = Array.from(child.children).map((one) => (one.textContent ?? "").trim())
        const [left, right] = [parts[0] ?? "", parts[1] ?? ""]
        out.push(right === "" ? left : left.padEnd(Math.max(cols - right.length, left.length + 1)) + right)
      } else if (tag === "p" && child.classList.contains("th-c")) {
        const text = (child.textContent ?? "").trim()
        out.push(" ".repeat(Math.max(0, Math.floor((cols - text.length) / 2))) + text)
      } else if (tag === "p" || tag === "span" || tag === "i" || tag === "b") {
        const text = (child.textContent ?? "").trim()
        if (text !== "") out.push(text)
      } else walk(child)
    }
  }
  walk(paper)
  return out.join("\n")
}

/// Print the slip that is on the screen: straight to the USB printer when the
/// till has one — no printer window — else the browser's own print, as before.
/// Resolves once it is on its way.
export async function printSlip(paper: string | undefined): Promise<string | null> {
  const wide = (paper ?? "NARROW").toUpperCase() === "WIDE"
  const text = slipText(wide ? 42 : 32)
  if (text !== "") {
    const sent = await printTextHere(text, wide ? "WIDE" : "NARROW")
    if (sent === "printed") return null
    if (sent !== "not-usb") return sent
  }
  window.print()
  return null
}
