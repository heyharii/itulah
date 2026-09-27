/// What is plugged into this till, and what that decides at the counter.
///
/// The shell keeps it (`src-tauri/src/peripherals.rs`) and tells the node,
/// signed as this till; this file is the window's reading of it. A
/// peripheral is configuration of the one till it hangs off, never a device of
/// its own (CONTEXT.md) — so there is no id here, no status, no key.
///
/// Two things at the counter are decided from it, both in `till.tsx`'s receipt
/// step: which printer a receipt goes to, and whether the drawer is kicked.

import { shellCall, type NodeConfig } from "@/session"

/// Where receipts go. `ADDRESS` is how every till printed before printers
/// were recorded — the host and port in Setelan terminal — and stays the
/// default, so a till that never opened the peripherals screen prints as it
/// always did.
export type ReceiptPrinter = "NONE" | "ADDRESS" | "RECORDED" | "USB"

/// `Peripherals` in `src-tauri/src/peripherals.rs`, field for field.
export type Peripherals = {
  readonly customer_display: boolean
  readonly customer_display_on_start: boolean
  /// The desk reader's model, `Chainway R3` today. Null: no reader.
  readonly desk_reader: string | null
  /// `PRINTER_PULSE` or `MANUAL`. Null: no drawer.
  readonly cash_drawer: string | null
  /// `USB_KEYBOARD` or `SERIAL`. Null: no scanner.
  readonly scanner: string | null
  readonly receipt_printer: ReceiptPrinter
  readonly printer_id: string | null
  readonly printer_label: string | null
  readonly usb_printer_model: string | null
  /// True while the node has not acknowledged this description.
  readonly unsent: boolean
  /// Unix seconds of the node's last acknowledgement.
  readonly reported_at: number | null
}

/// The shell's own default, repeated for a config file written before
/// peripherals existed and for the moment before the shell has answered.
export const DEFAULT_PERIPHERALS: Peripherals = {
  customer_display: false,
  customer_display_on_start: false,
  desk_reader: null,
  cash_drawer: "PRINTER_PULSE",
  scanner: null,
  receipt_printer: "ADDRESS",
  printer_id: null,
  printer_label: null,
  usb_printer_model: null,
  unsent: false,
  reported_at: null,
}

export function peripheralsOf(config: NodeConfig | null): Peripherals {
  return config?.peripherals ?? DEFAULT_PERIPHERALS
}

export type PeripheralsSaved = {
  /// The whole config as the shell now holds it.
  readonly config: NodeConfig
  /// True when the node took the description just now.
  readonly reported: boolean
  /// Why not, when it did not. The description is kept on this till either
  /// way.
  readonly problem: string | null
}

/// Keep a new description here, then tell the node.
export const savePeripherals = (next: Peripherals) =>
  shellCall<PeripheralsSaved>("set_peripherals", { next })

/// Tell the node again, unchanged.
export const reportPeripherals = () =>
  shellCall<PeripheralsSaved>("report_peripherals")

/// Where a receipt goes, in the shape the receipt route takes — or null, with
/// the sentence the cashier reads instead of a print.
///
/// A recorded printer is named by id and the node looks its address up
/// (`with_recorded_printer` in `backend/src/edge/http.rs`); a typed address is
/// sent as it always was. A USB printer on this till cannot be printed to: the
/// node renders receipts and the node cannot reach a USB port on a till, and
/// saying so beats a button that silently does nothing.
export function receiptTarget(config: NodeConfig | null): {
  readonly target:
    | { readonly printer_id: string }
    | { readonly printer_host: string; readonly printer_port: number }
    | null
  readonly why: string | null
} {
  if (config === null) return { target: null, why: null }
  const peripherals = peripheralsOf(config)
  switch (peripherals.receipt_printer) {
    case "RECORDED":
      return peripherals.printer_id !== null
        ? { target: { printer_id: peripherals.printer_id }, why: null }
        : { target: null, why: "Printer struk belum dipilih di Perangkat kasir." }
    case "USB":
      return {
        target: null,
        why:
          "Printer struk di kasir ini tersambung lewat USB, dan struk dicetak " +
          "oleh node — node belum bisa menjangkau printer USB. Cetak ulang dari " +
          "printer jaringan bila perlu.",
      }
    case "NONE":
      return { target: null, why: null }
    default:
      return config.printer_host !== null && config.printer_host !== ""
        ? {
            target: {
              printer_host: config.printer_host,
              printer_port: config.printer_port,
            },
            why: null,
          }
        : { target: null, why: null }
  }
}

/// What the first print of a sale does to the drawer. A reprint never kicks
/// it — the money is already in.
export function drawerOnSale(
  config: NodeConfig | null,
): "PRINTER_PULSE" | "MANUAL" | "NONE" {
  const drawer = peripheralsOf(config).cash_drawer
  if (drawer === "PRINTER_PULSE") return "PRINTER_PULSE"
  if (drawer === "MANUAL") return "MANUAL"
  return "NONE"
}
