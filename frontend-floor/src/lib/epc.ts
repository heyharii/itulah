/// Reading a tag, in the shop, with the line down.
///
/// A sale is a list of EPCs (`SaleRequest.epcs`) and the node resolves each one
/// to a unit and prices it. But a cashier cannot take money for a number they
/// have not been shown, and the store node has no "price this basket" endpoint
/// — `store_router` is receive · movements · sales · catalog · two reports, and
/// nothing else. So the basket has to be priced on this side of the wire.
///
/// It can be, exactly, because the EPC is not opaque: it carries the SKU. This
/// is a **mirror of `backend/src/cloud/domain/identity.rs`** — 96 bits, the
/// retail-private header `0xA0`, the 11 SKU digits as BCD, then a 44-bit
/// per-SKU serial. That file is the authority and this is the second
/// implementation of it; the golden vectors it tests against are the contract
/// between them.
///
/// What is derived here is an *identity*, never a price and never a movement.
/// The line total on screen is a quote read out of the catalogue the node
/// published to this shop; the money is whatever `POST /store/sales` answers,
/// because the pricing engine — markdowns, coupons, whole-cart promotions —
/// runs there and only there. If the two ever disagree, the receipt is right.

/// Digits in a SKU: article(8) + colour(1) + size(2).
const SKU_LEN = 11
/// Hex characters in a 96-bit EPC.
const EPC_HEX_LEN = 24
/// Marks a tag as ours rather than a GS1 SGTIN (`0x30`), a GIAI (`0x34`) or a
/// factory TID.
const RETAIL_PRIVATE_HEADER = 0xa0

export interface DecodedEpc {
  /// The 11-digit SKU this tag was written for.
  readonly sku_code: string
  /// Which unit of that SKU. Two tags with the same SKU and different serials
  /// are two garments, and a sale of both is a sale of two.
  readonly serial: number
}

/// Uppercase, trimmed. The estate's canonical rendering, and there is a
/// database constraint that says so — but hex case is not part of the
/// identity, so everything here normalises rather than comparing raw strings.
export function normalizeEpc(value: string): string {
  return value.trim().toUpperCase()
}

/// Read a tag back: which SKU, and which unit of it.
///
/// Returns `null` rather than throwing. A scanner pointed at a supplier's own
/// GS1 label produces a perfectly valid EPC that is not ours, and that is an
/// ordinary event at a counter — the caller shows a sentence, not a stack
/// trace.
export function decodeEpc(value: string): DecodedEpc | null {
  const hex = value.trim().toLowerCase()
  if (hex.length !== EPC_HEX_LEN || !/^[0-9a-f]+$/.test(hex)) return null

  const bytes = new Uint8Array(12)
  for (let index = 0; index < 12; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }
  if (bytes[0] !== RETAIL_PRIVATE_HEADER) return null

  let sku = ""
  for (let i = 0; i < 10; i += 1) {
    const index = 1 + Math.floor(i / 2)
    const nibble = i % 2 === 0 ? bytes[index] >> 4 : bytes[index] & 0x0f
    // A nibble above 9 is not a decimal digit, so this is not a BCD SKU —
    // somebody else's tag wearing our header, or a corrupt read.
    if (nibble > 9) return null
    sku += String(nibble)
  }
  const last = bytes[6] >> 4
  if (last > 9) return null
  sku += String(last)

  // 44 bits does not fit in JavaScript's 32-bit bitwise operators, so the top
  // of the serial is assembled by multiplication. Everything below 2^53 is
  // exact in a double, and 2^44 is comfortably inside that.
  const serial =
    (bytes[6] & 0x0f) * 2 ** 40 +
    bytes[7] * 2 ** 32 +
    bytes[8] * 2 ** 24 +
    bytes[9] * 2 ** 16 +
    bytes[10] * 2 ** 8 +
    bytes[11]

  return { sku_code: sku, serial }
}

/// What a scanner just sent, whatever kind of code it was pointed at.
///
/// Three formats reach this app from the same wedge keyboard and they mean
/// different things, which is why they are told apart here rather than at three
/// call sites:
///
///   - an **EPC** identifies one garment, and only an EPC can be sold;
///   - a **barcode** (`8<sku>`) and a **QR** (`R1:<sku>`) identify a *product*,
///     so they answer "how much is this" and cannot be put in a basket — the
///     shop has forty of that shirt and this says nothing about which one.
export type Scanned =
  | { readonly kind: "epc"; readonly epc: string; readonly sku_code: string }
  | { readonly kind: "sku"; readonly sku_code: string }
  | { readonly kind: "unknown"; readonly raw: string }

export function readScan(raw: string): Scanned {
  const value = raw.trim()
  if (value === "") return { kind: "unknown", raw }

  const decoded = decodeEpc(value)
  if (decoded !== null) {
    return {
      kind: "epc",
      epc: normalizeEpc(value),
      sku_code: decoded.sku_code,
    }
  }

  // `R1:` says "retail identifier, payload version 1" — a scanner meeting a
  // future `R2:` should know it is out of date instead of misreading it, so
  // the prefix is matched exactly.
  if (value.startsWith("R1:")) {
    const sku = value.slice(3)
    if (isSkuCode(sku)) return { kind: "sku", sku_code: sku }
  }
  if (value.length === SKU_LEN + 1 && value.startsWith("8")) {
    const sku = value.slice(1)
    if (isSkuCode(sku)) return { kind: "sku", sku_code: sku }
  }
  if (isSkuCode(value)) return { kind: "sku", sku_code: value }

  return { kind: "unknown", raw: value }
}

/// Eleven ASCII digits: article(8) + colour(1) + size(2). Not exported —
/// `readScan` is the only thing that should be deciding what a code is.
function isSkuCode(value: string): boolean {
  return value.length === SKU_LEN && /^\d+$/.test(value)
}
