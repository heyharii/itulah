/// What is plugged into this till.
///
/// # One screen, one till
///
/// A peripheral is part of the till it hangs off — the shopper's screen, the
/// Chainway R3 on the desk, the drawer, the scanner, the receipt printer — and
/// is set here, on that till, by whoever installed it. It is kept by the shell
/// and told to the node signed as this till, so the node and head office see
/// what each counter has without anybody writing it down twice.
///
/// # What it decides
///
/// The receipt printer and the drawer are not a description only: the sale
/// screen reads them. A receipt goes to the printer chosen here — a printer the
/// node has recorded, named by id; the address typed in Setelan terminal; or
/// nowhere — and the drawer is kicked with the first print only when it is
/// opened by the printer.
///
/// # What it cannot do yet
///
/// Print to a USB printer. Receipts are rendered and sent by the node, and the
/// node cannot reach a USB port on a till; the choice is recorded and
/// reported, and the sale screen says so instead of printing.

import { useEffect, useState } from "react"

import * as api from "@/api"
import { device, openCustomerDisplay } from "@/edge"
import { Icon } from "@/icons"
import {
  peripheralsOf,
  reportPeripherals,
  savePeripherals,
  type Peripherals,
  type ReceiptPrinter,
} from "@/peripherals"
import { adoptConfig, useNodeConfig, useSession } from "@/session"
import { Topbar } from "@/till"

/// The desk reader every counter has today. Anything else is typed.
const R3 = "Chainway R3"
const OTHER = "__other"

type Printer = {
  readonly id: string
  readonly label: string
  readonly where: string
  readonly purpose: string
}

export function PeripheralsScreen({ onBack }: { onBack: () => void }) {
  const session = useSession()
  const { config } = useNodeConfig()
  const [form, setForm] = useState<Peripherals | null>(null)
  const [readerChoice, setReaderChoice] = useState("")
  const [printers, setPrinters] = useState<readonly Printer[] | null>(null)
  const [printersProblem, setPrintersProblem] = useState<string | null>(null)
  const [reader, setReader] = useState<{ bound: boolean; detail: string } | null>(null)
  const [note, setNote] = useState<{ bad: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  /// Put on screen what the shell holds. Once at first, and again after a
  /// save — never under somebody's hands when the config merely refreshes.
  const seed = (held: Peripherals) => {
    setForm(held)
    setReaderChoice(
      held.desk_reader === null ? "" : held.desk_reader === R3 ? R3 : OTHER,
    )
  }

  useEffect(() => {
    if (config === null || form !== null) return
    seed(peripheralsOf(config))
  }, [config, form])

  // The printers the node has recorded. Listing them needs somebody signed in
  // here; before that, the choice already made is still shown by name.
  useEffect(() => {
    if (session.me === null) {
      setPrinters(null)
      return
    }
    let alive = true
    void (async () => {
      const reply = await api.devices()
      if (!alive) return
      if (!reply.ok) {
        setPrinters([])
        setPrintersProblem(reply.problem)
        return
      }
      setPrintersProblem(null)
      setPrinters(
        (reply.body?.items ?? [])
          .filter((one) => one.kind === "PRINTER" && one.status === "ACTIVE")
          .map((one) => ({
            id: one.device_id,
            label: one.label,
            where:
              one.config?.host !== undefined
                ? `${one.config.host}:${one.config.port ?? 9100}`
                : "",
            purpose: one.config?.purpose ?? "LABEL",
          }))
          // Receipt printers first: a label printer can take a receipt, but
          // it is rarely what somebody setting up a counter is looking for.
          .sort((a, b) =>
            a.purpose === b.purpose
              ? a.label.localeCompare(b.label)
              : a.purpose === "RECEIPT"
                ? -1
                : 1,
          ),
      )
    })()
    return () => {
      alive = false
    }
  }, [session.me])

  const checkReader = async () => {
    setReader(null)
    setReader(await device("rfid_state"))
  }
  useEffect(() => {
    void checkReader()
  }, [])

  if (form === null) {
    return (
      <div id="app" data-screen="sale">
        <Topbar />
        <div className="empty">
          <p>Membaca setelan…</p>
        </div>
      </div>
    )
  }

  const change = (patch: Partial<Peripherals>) =>
    setForm((now) => (now === null ? now : { ...now, ...patch }))

  const printerValue =
    form.receipt_printer === "RECORDED" && form.printer_id !== null
      ? `RECORDED:${form.printer_id}`
      : form.receipt_printer
  const chosenListed =
    form.printer_id !== null &&
    (printers ?? []).some((printer) => printer.id === form.printer_id)

  function choosePrinter(value: string) {
    if (value.startsWith("RECORDED:")) {
      const id = value.slice("RECORDED:".length)
      const printer = (printers ?? []).find((one) => one.id === id)
      change({
        receipt_printer: "RECORDED",
        printer_id: id,
        printer_label: printer?.label ?? form?.printer_label ?? null,
      })
      return
    }
    change({ receipt_printer: value as ReceiptPrinter })
  }

  async function commit() {
    if (form === null) return
    setBusy(true)
    setNote(null)
    const saved = await savePeripherals(form)
    setBusy(false)
    if (!saved.ok) {
      setNote({ bad: true, text: saved.problem })
      return
    }
    adoptConfig(saved.value.config)
    seed(peripheralsOf(saved.value.config))
    setNote(
      saved.value.reported
        ? { bad: false, text: "Tersimpan di kasir ini dan sudah dilaporkan ke node." }
        : {
            bad: true,
            text:
              "Tersimpan di kasir ini, belum sampai ke node — dikirim ulang saat " +
              `aplikasi dibuka lagi. ${saved.value.problem ?? ""}`,
          },
    )
  }

  async function resend() {
    setBusy(true)
    setNote(null)
    const sent = await reportPeripherals()
    setBusy(false)
    if (!sent.ok) {
      setNote({ bad: true, text: sent.problem })
      return
    }
    // Only the badge below changes: what is being edited stays as it is.
    adoptConfig(sent.value.config)
    setNote(
      sent.value.reported
        ? { bad: false, text: "Sudah dilaporkan ke node." }
        : { bad: true, text: sent.value.problem ?? "Node belum menerima laporannya." },
    )
  }

  const held = peripheralsOf(config)
  const joined = config?.pairing_id !== null && config?.pairing_id !== undefined
  const reportedAt =
    held.reported_at !== null
      ? new Date(held.reported_at * 1000).toLocaleString("id-ID")
      : null

  return (
    <div id="app" data-screen="sale">
      <Topbar />
      <main className="page">
        <form
          className="page-inner"
          style={{ maxWidth: 620 }}
          onSubmit={(event) => {
            event.preventDefault()
            void commit()
          }}
        >
          <div className="page-head">
            <div>
              <h1>Perangkat kasir</h1>
              <p>
                Yang tersambung ke {config?.terminal_id ?? "kasir ini"}. Disimpan
                di kasir ini dan dilaporkan ke node toko.
              </p>
            </div>
            <button className="btn ghost" type="button" onClick={onBack}>
              <Icon name="back" />
              Kembali
            </button>
          </div>

          {/* ── the shopper's screen ── */}
          <section className="rows">
            <span className="label">Layar pelanggan</span>
            <label className="check">
              <input
                type="checkbox"
                checked={form.customer_display}
                onChange={(event) =>
                  change({
                    customer_display: event.target.checked,
                    customer_display_on_start:
                      event.target.checked && form.customer_display_on_start,
                  })
                }
              />
              Ada layar kedua yang menghadap pembeli
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={form.customer_display_on_start}
                disabled={!form.customer_display}
                onChange={(event) =>
                  change({ customer_display_on_start: event.target.checked })
                }
              />
              Buka otomatis saat aplikasi kasir dibuka
            </label>
            <div>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  void openCustomerDisplay().then((problem) => {
                    if (problem !== null) setNote({ bad: true, text: problem })
                  })
                }}
              >
                <Icon name="monitor" />
                Buka sekarang
              </button>
            </div>
          </section>

          {/* ── the desk reader ── */}
          <section className="rows">
            <span className="label">Pembaca RFID meja</span>
            <label className="field">
              Pembaca yang tersambung lewat USB
              <select
                value={readerChoice}
                onChange={(event) => {
                  const value = event.target.value
                  setReaderChoice(value)
                  change({
                    desk_reader:
                      value === ""
                        ? null
                        : value === R3
                          ? R3
                          : form.desk_reader !== null && form.desk_reader !== R3
                            ? form.desk_reader
                            : "",
                  })
                }}
              >
                <option value="">Tidak ada</option>
                <option value={R3}>{R3}</option>
                <option value={OTHER}>Lainnya…</option>
              </select>
            </label>
            {readerChoice === OTHER && (
              <label className="field">
                Model pembaca
                <input
                  value={form.desk_reader ?? ""}
                  onChange={(event) => change({ desk_reader: event.target.value })}
                  placeholder="Merek dan model, seperti tertulis di perangkat"
                  autoComplete="off"
                />
              </label>
            )}
            <div className="kv">
              <span className="muted" style={{ fontSize: 12 }}>
                {reader === null ? "Memeriksa pembaca…" : reader.detail}
              </span>
              <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {reader !== null && (
                  <span className={reader.bound ? "badge ok" : "badge plain"}>
                    {reader.bound ? "Terhubung" : "Tidak terbaca"}
                  </span>
                )}
                <button className="btn ghost" type="button" onClick={() => void checkReader()}>
                  Periksa
                </button>
              </span>
            </div>
          </section>

          {/* ── drawer and scanner ── */}
          <section className="rows">
            <span className="label">Laci kas dan pemindai</span>
            <div style={{ display: "flex", gap: 10 }}>
              <label className="field" style={{ flex: 1 }}>
                Laci kas
                <select
                  value={form.cash_drawer ?? ""}
                  onChange={(event) =>
                    change({
                      cash_drawer: event.target.value === "" ? null : event.target.value,
                    })
                  }
                >
                  <option value="">Tidak ada laci</option>
                  <option value="PRINTER_PULSE">Dibuka printer struk</option>
                  <option value="MANUAL">Dibuka manual (kunci)</option>
                </select>
              </label>
              <label className="field" style={{ flex: 1 }}>
                Pemindai barcode
                <select
                  value={form.scanner ?? ""}
                  onChange={(event) =>
                    change({
                      scanner: event.target.value === "" ? null : event.target.value,
                    })
                  }
                >
                  <option value="">Tidak ada pemindai</option>
                  <option value="USB_KEYBOARD">USB — mengetik ke kolom pindai</option>
                  <option value="SERIAL">Serial</option>
                </select>
              </label>
            </div>
          </section>

          {/* ── the receipt printer ── */}
          <section className="rows">
            <span className="label">Printer struk</span>
            <label className="field">
              Struk dicetak ke
              <select value={printerValue} onChange={(event) => choosePrinter(event.target.value)}>
                <option value="NONE">Tanpa printer struk</option>
                <option value="ADDRESS">
                  {config?.printer_host
                    ? `Alamat di Setelan terminal — ${config.printer_host}:${config.printer_port}`
                    : "Alamat di Setelan terminal (belum diisi)"}
                </option>
                {form.printer_id !== null && !chosenListed && (
                  <option value={`RECORDED:${form.printer_id}`}>
                    {form.printer_label ?? form.printer_id} — tercatat di node
                  </option>
                )}
                {(printers ?? []).map((printer) => (
                  <option key={printer.id} value={`RECORDED:${printer.id}`}>
                    {printer.label}
                    {printer.where !== "" ? ` — ${printer.where}` : ""}
                    {printer.purpose !== "RECEIPT" ? " (printer label)" : ""}
                  </option>
                ))}
                <option value="USB">Printer USB di kasir ini</option>
              </select>
            </label>
            {session.me === null && (
              <p className="muted" style={{ fontSize: 12 }}>
                Masuk dulu untuk memilih printer jaringan yang tercatat di node.
              </p>
            )}
            {printersProblem !== null && (
              <p className="muted" style={{ fontSize: 12 }}>
                Daftar printer node tidak bisa dibaca: {printersProblem}
              </p>
            )}
            {form.receipt_printer === "USB" && (
              <>
                <label className="field">
                  Model printer USB
                  <input
                    value={form.usb_printer_model ?? ""}
                    onChange={(event) => change({ usb_printer_model: event.target.value })}
                    placeholder="Misalnya Epson TM-T82"
                    autoComplete="off"
                  />
                </label>
                <div className="notice warn">
                  Struk dicetak oleh node, dan node belum bisa menjangkau printer
                  USB di kasir. Pilihan ini dicatat dan dilaporkan, tetapi struk
                  belum akan keluar dari printer ini.
                </div>
              </>
            )}
            <p className="muted" style={{ fontSize: 12 }}>
              Lebar kertas ({config?.paper === "WIDE" ? "80 mm" : "58 mm"}) diatur
              di Setelan terminal.
            </p>
          </section>

          {/* ── what the node has been told ── */}
          <div className="kv">
            <span className="muted">Laporan ke node</span>
            {!joined ? (
              <span className="badge plain">Kasir belum tergabung — disimpan di sini</span>
            ) : held.unsent ? (
              <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span className="badge warn">Belum terkirim</span>
                <button
                  className="btn ghost"
                  type="button"
                  disabled={busy}
                  onClick={() => void resend()}
                >
                  Kirim ulang
                </button>
              </span>
            ) : (
              <span className="badge ok">
                Terkirim{reportedAt !== null ? ` · ${reportedAt}` : ""}
              </span>
            )}
          </div>

          {note !== null && (
            <p className={note.bad ? "error" : "muted"}>{note.text}</p>
          )}

          <div className="action-bar">
            <button className="btn" type="button" onClick={onBack}>
              Kembali
            </button>
            <button
              className="btn primary"
              type="submit"
              style={{ flex: 1 }}
              disabled={busy}
            >
              {busy ? "Menyimpan…" : "Simpan"}
            </button>
          </div>
        </form>
      </main>
    </div>
  )
}
