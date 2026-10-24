import { useSyncExternalStore } from "react"

import * as api from "@/api"
import type { IconName } from "@/icons"

/// The tiles on the payment page, built from the payment methods Finance keeps
/// in the cloud master (ERPNext Mode of Payment) rather than a list in code.
///
/// One tile per tender type — "Debit", then the bank is chosen among the
/// DEBIT_CARD methods — so the page keeps its shape however many banks Finance
/// adds. Read on sign-in and again whenever a shift is opened, held in memory
/// and in this terminal's storage, and never allowed to leave the till unable
/// to sell: if the node cannot answer and nothing was ever read, the built-in
/// list the till always had is shown instead.

/// One method under a tile: what the bank picker shows, and what the tender
/// carries.
export type MethodChoice = {
  /// The master's code, or null for the built-in fallback list.
  readonly code: string | null
  readonly label: string
  /// Upper-cased, as the node wants `acquirer`.
  readonly acquirer: string | null
}

export type MethodTile = {
  /// The tender type (`DEBIT_CARD`…), or the old tile value on the fallback.
  readonly key: string
  readonly label: string
  readonly icon: IconName
  /// What the node accepts as `method`.
  readonly wire: "CASH" | "CARD" | "QRIS" | "EWALLET" | "VOUCHER" | "BENEFIT"
  readonly cardKind: "DEBIT" | "CREDIT" | null
  /// Whether a bank / acquirer has to be named for this tile at all.
  readonly needsBank: boolean
  readonly choices: readonly MethodChoice[]
}

const SHAPE: Record<
  string,
  Omit<MethodTile, "key" | "choices" | "needsBank"> & { order: number }
> = {
  CASH: { label: "Cash", icon: "cash", wire: "CASH", cardKind: null, order: 0 },
  DEBIT_CARD: { label: "Debit", icon: "card", wire: "CARD", cardKind: "DEBIT", order: 1 },
  CREDIT_CARD: { label: "Credit", icon: "card", wire: "CARD", cardKind: "CREDIT", order: 2 },
  QRIS: { label: "QRIS", icon: "qr", wire: "QRIS", cardKind: null, order: 3 },
  EWALLET: { label: "E-wallet", icon: "wallet", wire: "EWALLET", cardKind: null, order: 4 },
  VOUCHER: { label: "Voucher", icon: "voucher", wire: "VOUCHER", cardKind: null, order: 5 },
  BENEFIT: { label: "Employee balance", icon: "wallet", wire: "BENEFIT", cardKind: null, order: 6 },
  // POINTS is not a tile: a member's points are paid as a voucher from the
  // Poin row, and the method only says whether this shop offers that row.
}

/// The banks the till offered before the master existed — every unit's chart
/// of accounts keeps `Penjualan Debit Card Bank BCA / Mandiri / BRI / BNI`.
const FALLBACK_BANKS = ["BCA", "Mandiri", "BRI", "BNI"]

const bankChoices = (): MethodChoice[] =>
  FALLBACK_BANKS.map((bank) => ({
    code: null,
    label: bank,
    acquirer: bank.toUpperCase(),
  }))

/// Exactly what the till showed before: cash, debit, credit, QRIS, voucher, employee balance.
export const FALLBACK_TILES: readonly MethodTile[] = [
  { key: "CASH", ...SHAPE.CASH, needsBank: false, choices: [{ code: null, label: "Cash", acquirer: null }] },
  { key: "DEBIT", ...SHAPE.DEBIT_CARD, needsBank: true, choices: bankChoices() },
  { key: "CREDIT", ...SHAPE.CREDIT_CARD, needsBank: true, choices: bankChoices() },
  { key: "QRIS", ...SHAPE.QRIS, needsBank: true, choices: bankChoices() },
  { key: "VOUCHER", ...SHAPE.VOUCHER, needsBank: false, choices: [{ code: null, label: "Voucher", acquirer: null }] },
  { key: "BENEFIT", ...SHAPE.BENEFIT, needsBank: false, choices: [{ code: null, label: "Employee balance", acquirer: null }] },
].map(({ order: _order, ...tile }) => tile)

/// Group the master's methods into tiles. Null when nothing usable came back,
/// which the caller treats the same as a failed read.
export function tilesFrom(
  methods: readonly api.PaymentMethod[],
): MethodTile[] | null {
  const groups = new Map<string, MethodChoice[]>()
  for (const one of methods) {
    if (typeof one?.code !== "string" || SHAPE[one.tender_type] === undefined) {
      continue
    }
    const bank = typeof one.bank_code === "string" && one.bank_code.trim() !== ""
      ? one.bank_code.trim().toUpperCase()
      : null
    const list = groups.get(one.tender_type) ?? []
    list.push({ code: one.code, label: one.name || bank || one.code, acquirer: bank })
    groups.set(one.tender_type, list)
  }
  if (groups.size === 0) return null
  return [...groups.entries()]
    .sort(([a], [b]) => SHAPE[a].order - SHAPE[b].order)
    .map(([type, choices]) => {
      const { order: _order, ...shape } = SHAPE[type]
      return {
        key: type,
        ...shape,
        // Cash and voucher settle without a bank; everything else names one,
        // and a tile with several methods always needs one picked.
        needsBank: choices.length > 1 || choices.some((one) => one.acquirer !== null),
        choices,
      }
    })
}

// ── the counter's EDC machines ──────────────────────────────────────────

/// One kind a machine takes, as the tender needs it: the tile gives the wire
/// method and card kind, the choice the method code and the acquirer.
export type EdcWay = { readonly tile: MethodTile; readonly choice: MethodChoice }

/// One EDC of this shop's counter (0989): head office sets per shop and bank
/// what the machine takes, and the shop's debit, credit and QRIS methods are
/// read off it — so the machines come back out of the same list.
export type EdcMachine = {
  /// The bank, upper-cased ("BCA", "MANDIRI"): stable, and what a tender on
  /// this machine carries as `acquirer`.
  readonly id: string
  /// The bank as the cashier says it: "BCA", "Mandiri".
  readonly bank: string
  /// "EDC BCA", or "QRIS BCA" for a bank's QR stand with no card reader.
  readonly name: string
  readonly debit: EdcWay | null
  readonly credit: EdcWay | null
  readonly qris: EdcWay | null
}

const bankWord = (code: string) =>
  code.length <= 4 ? code : code.charAt(0) + code.slice(1).toLowerCase()

/// The machines in the shop's list, in the order their banks first appear
/// (debit, then credit, then QRIS). On a node that was never sent a list
/// this is today's built-in four, each taking all three.
export function edcMachinesFrom(from: readonly MethodTile[]): EdcMachine[] {
  const banks = new Map<string, { debit: EdcWay | null; credit: EdcWay | null; qris: EdcWay | null }>()
  for (const tile of from) {
    const slot =
      tile.wire === "QRIS" ? "qris" : tile.wire !== "CARD" ? null : tile.cardKind === "CREDIT" ? "credit" : "debit"
    if (slot === null) continue
    for (const choice of tile.choices) {
      const id = (choice.acquirer ?? choice.label).trim().toUpperCase()
      if (id === "") continue
      const bank = banks.get(id) ?? { debit: null, credit: null, qris: null }
      if (bank[slot] === null) bank[slot] = { tile, choice }
      banks.set(id, bank)
    }
  }
  return [...banks.entries()].map(([id, ways]) => ({
    id,
    bank: bankWord(id),
    name: `${ways.debit === null && ways.credit === null ? "QRIS" : "EDC"} ${bankWord(id)}`,
    ...ways,
  }))
}

// ── the held copy ───────────────────────────────────────────────────────

const STORAGE_KEY = "itulah.pos.payment-methods"

/// Whether the shop's list offers members' points (0989). A list from before
/// points were a method has none, and the built-in list always offered them.
const pointsIn = (methods: readonly api.PaymentMethod[]) =>
  methods.some((one) => one?.tender_type === "POINTS")

function readStored(): { tiles: MethodTile[]; points: boolean } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    const stored = tilesFrom(parsed as api.PaymentMethod[])
    return stored === null ? null : { tiles: stored, points: pointsIn(parsed as api.PaymentMethod[]) }
  } catch {
    return null
  }
}

const held = readStored()
let tiles: readonly MethodTile[] = held?.tiles ?? FALLBACK_TILES
let points = held?.points ?? true
let machines: readonly EdcMachine[] = edcMachinesFrom(tiles)
let fromMaster = tiles !== FALLBACK_TILES
const listeners = new Set<() => void>()

/// Ask the node again. A failure keeps whatever was last shown — the last good
/// master list, or the built-in one — so a till never loses the ability to sell
/// because the master could not be read.
export async function refreshPaymentMethods(): Promise<void> {
  const reply = await api.paymentMethods()
  const next = reply.ok && Array.isArray(reply.body) ? tilesFrom(reply.body) : null
  if (next === null) {
    console.warn(
      `Payment methods could not be read from master data (${reply.problem ?? "empty list"}); ` +
        (fromMaster ? "using the last list." : "using the till's built-in list."),
    )
    return
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(reply.body))
  } catch {
    // Nowhere to keep it; the in-memory copy still serves this session.
  }
  tiles = next
  machines = edcMachinesFrom(next)
  points = pointsIn(Array.isArray(reply.body) ? reply.body : [])
  fromMaster = true
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function usePaymentMethods(): readonly MethodTile[] {
  return useSyncExternalStore(subscribe, () => tiles)
}

/// This shop's EDC machines, kept with the list they are read from.
export function useEdcMachines(): readonly EdcMachine[] {
  return useSyncExternalStore(subscribe, () => machines)
}

/// Whether Bayar offers the member's points (the Poin row) at this shop.
export function usePointsOffered(): boolean {
  return useSyncExternalStore(subscribe, () => points)
}
