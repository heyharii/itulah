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
/// # A USB printer
///
/// Printed to by this till itself. The node renders the receipt, as it renders
/// every receipt, and the shell sends the bytes to the printer by the name this
/// machine knows it under — the Windows spooler as a RAW job, or a CUPS queue
/// on a Mac or Linux till (`src-tauri/src/printer.rs`). The name is chosen from
/// the machine's own list, and a test print proves it before a customer does.

import { Fragment, useEffect, useState } from "react"

import * as api from "@/api"
import { device, openCustomerDisplay, readRfidPad, type PadRead } from "@/edge"
import { Icon } from "@/icons"
import {
  localPrinters,
  peripheralsOf,
  reportPeripherals,
  savePeripherals,
  testUsbPrinter,
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

/// The reader a test read ran on and its radio profile, as the shell read
/// them back when it last set the reader up (`src-tauri/src/rfid.rs`).
/// Read-only: the shell sets the profile itself on opening and after a reset.
function ReadWith({ read }: { read: PadRead }) {
  const { profile } = read
  const rows: readonly (readonly [string, string])[] = [
    ["Firmware", read.firmware],
    ["FastID", profile.fast_id ? "On" : "Off"],
    ["Tag Focus", profile.tag_focus ? "On" : "Off"],
    ["Session", profile.session],
    ["Target", profile.target],
    [
      "RF link",
      profile.rf_link_moved_from === null
        ? profile.rf_link
        : `${profile.rf_link} · switched from ${profile.rf_link_moved_from}, not saved in the reader`,
    ],
  ]
  return (
    <dl
      style={{
        display: "grid",
        gridTemplateColumns: "max-content 1fr",
        gap: "2px 16px",
        margin: 0,
        fontSize: 15,
      }}
    >
      {rows.map(([label, value]) => (
        <Fragment key={label}>
          <dt className="muted">{label}</dt>
          <dd style={{ margin: 0, minWidth: 0, overflowWrap: "anywhere" }}>{value}</dd>
        </Fragment>
      ))}
    </dl>
  )
}

export function PeripheralsScreen({ onBack }: { onBack: () => void }) {
  const session = useSession()
  const { config } = useNodeConfig()
  const [form, setForm] = useState<Peripherals | null>(null)
  const [readerChoice, setReaderChoice] = useState("")
  const [printers, setPrinters] = useState<readonly Printer[] | null>(null)
  const [printersProblem, setPrintersProblem] = useState<string | null>(null)
  const [reader, setReader] = useState<{ bound: boolean; detail: string } | null>(null)
  /// The last test read of the R3's pad, for setting its power on the bench.
  const [padTest, setPadTest] = useState<{
    bad: boolean
    text: string
    read: PadRead | null
  } | null>(null)
  const [note, setNote] = useState<{ bad: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  /// The printers this machine has, for the USB choice. Null until asked.
  const [usbPrinters, setUsbPrinters] = useState<readonly string[] | null>(null)
  const [usbProblem, setUsbProblem] = useState<string | null>(null)
  const [usbTest, setUsbTest] = useState<{ bad: boolean; text: string } | null>(
    null,
  )

  const listUsbPrinters = async () => {
    setUsbProblem(null)
    const listed = await localPrinters()
    if (!listed.ok) {
      setUsbPrinters([])
      setUsbProblem(listed.problem)
      return
    }
    setUsbPrinters(listed.value)
  }

  // Asked once the USB choice is on screen: a till without one never needs
  // the machine's printer list.
  const usbChosen = form?.receipt_printer === "USB"
  useEffect(() => {
    if (usbChosen && usbPrinters === null) void listUsbPrinters()
  }, [usbChosen, usbPrinters])

  /// The saved choice, printed on: a name that is only typed here has not
  /// reached the shell yet, and the shell is what prints.
  async function testUsb() {
    setUsbTest(null)
    const printed = await testUsbPrinter()
    setUsbTest(
      printed.ok
        ? { bad: false, text: `Test sent to ${printed.value.printer}.` }
        : { bad: true, text: printed.problem },
    )
  }

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

  /// One read of the pad with the settings this till has saved — the shell
  /// reads those, not this form — listing every tag with its signal, so the
  /// power can be lowered until only the pad's garments are read.
  async function testPad() {
    setPadTest(null)
    try {
      const read = await readRfidPad()
      setPadTest({
        bad: false,
        read,
        text:
          `${read.tags.length} ${read.tags.length === 1 ? "tag" : "tags"} at ` +
          `${read.power_dbm} dBm in ${read.window_ms} ms` +
          (read.too_weak > 0 ? ` · ${read.too_weak} below ${read.min_rssi_dbm} dBm left out` : "") +
          (read.unreadable > 0 ? ` · ${read.unreadable} unreadable` : ""),
      })
    } catch (error) {
      setPadTest({
        bad: true,
        read: null,
        text: error instanceof Error ? error.message : String(error),
      })
    }
  }

  if (form === null) {
    return (
      <div id="app" data-screen="sale">
        <Topbar />
        <div className="empty">
          <p>Reading settings…</p>
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
        ? { bad: false, text: "Saved on this till and already reported to the node." }
        : {
            bad: true,
            text:
              "Saved on this till, not yet at the node — it is resent when " +
              `the app is opened again. ${saved.value.problem ?? ""}`,
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
        ? { bad: false, text: "Already reported to the node." }
        : { bad: true, text: sent.value.problem ?? "The node has not accepted the report yet." },
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
              <h1>Till devices</h1>
              <p>
                What is connected to {config?.terminal_id ?? "this till"}. Saved
                on this till and reported to the store node.
              </p>
            </div>
            <button className="btn ghost" type="button" onClick={onBack}>
              <Icon name="back" />
              Back
            </button>
          </div>

          {/* ── the shopper's screen ── */}
          <section className="rows">
            <span className="label">Customer display</span>
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
              There is a second screen facing the shopper
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
              Open automatically when the till app starts
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
                Open now
              </button>
            </div>
          </section>

          {/* ── the desk reader ── */}
          <section className="rows">
            <span className="label">Desk RFID reader</span>
            <label className="field">
              Reader connected over USB
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
                <option value="">None</option>
                <option value={R3}>{R3}</option>
                <option value={OTHER}>Other…</option>
              </select>
            </label>
            {readerChoice === OTHER && (
              <label className="field">
                Reader model
                <input
                  value={form.desk_reader ?? ""}
                  onChange={(event) => change({ desk_reader: event.target.value })}
                  placeholder="Make and model, as written on the device"
                  autoComplete="off"
                />
              </label>
            )}
            <div className="kv">
              <span className="muted" style={{ fontSize: 12 }}>
                {reader === null ? "Checking the reader…" : reader.detail}
              </span>
              <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {reader !== null && (
                  <span className={reader.bound ? "badge ok" : "badge plain"}>
                    {reader.bound ? "Connected" : "Not readable"}
                  </span>
                )}
                <button className="btn ghost" type="button" onClick={() => void checkReader()}>
                  Check
                </button>
              </span>
            </div>
            {/* Bench values (README): the power decides how far the R3
                reaches, and only the pad may be within reach. */}
            {readerChoice === R3 && (
              <>
                <div style={{ display: "flex", gap: 10 }}>
                  <label className="field" style={{ flex: 1 }}>
                    Power (dBm)
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={30}
                      step={1}
                      value={form.r3_power_dbm ?? 15}
                      onChange={(event) =>
                        change({ r3_power_dbm: Number(event.target.value) })
                      }
                    />
                  </label>
                  <label className="field" style={{ flex: 1 }}>
                    One read (ms)
                    <input
                      type="number"
                      inputMode="numeric"
                      min={200}
                      max={2000}
                      step={50}
                      value={form.r3_read_ms ?? 500}
                      onChange={(event) =>
                        change({ r3_read_ms: Number(event.target.value) })
                      }
                    />
                  </label>
                  <label className="field" style={{ flex: 1 }}>
                    Weakest kept (dBm)
                    <input
                      type="number"
                      inputMode="numeric"
                      min={-100}
                      max={-20}
                      step={1}
                      value={form.r3_min_rssi_dbm ?? -70}
                      onChange={(event) =>
                        change({ r3_min_rssi_dbm: Number(event.target.value) })
                      }
                    />
                  </label>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button
                    className="btn"
                    type="button"
                    disabled={busy}
                    title="Reads with the saved settings. Save first."
                    onClick={() => void testPad()}
                  >
                    <Icon name="rfid" />
                    Test read
                  </button>
                  {padTest !== null && (
                    <span className={padTest.bad ? "error" : "muted"} style={{ fontSize: 15 }}>
                      {padTest.text}
                    </span>
                  )}
                </div>
                {padTest !== null && padTest.read !== null && (
                  <ReadWith read={padTest.read} />
                )}
                {padTest !== null && padTest.read !== null && padTest.read.tags.length > 0 && (
                  <ul className="muted num" style={{ fontSize: 15, margin: 0, paddingLeft: 18 }}>
                    {padTest.read.tags.map((tag) => (
                      <li key={tag.epc}>
                        {tag.epc} · {tag.rssi_dbm.toFixed(1)} dBm · read {tag.reads}×
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>

          {/* ── drawer and scanner ── */}
          <section className="rows">
            <span className="label">Cash drawer and scanner</span>
            <div style={{ display: "flex", gap: 10 }}>
              <label className="field" style={{ flex: 1 }}>
                Cash drawer
                <select
                  value={form.cash_drawer ?? ""}
                  onChange={(event) =>
                    change({
                      cash_drawer: event.target.value === "" ? null : event.target.value,
                    })
                  }
                >
                  <option value="">No drawer</option>
                  <option value="PRINTER_PULSE">Opened by the receipt printer</option>
                  <option value="MANUAL">Opened by hand (key)</option>
                </select>
              </label>
              <label className="field" style={{ flex: 1 }}>
                Barcode scanner
                <select
                  value={form.scanner ?? ""}
                  onChange={(event) =>
                    change({
                      scanner: event.target.value === "" ? null : event.target.value,
                    })
                  }
                >
                  <option value="">No scanner</option>
                  <option value="USB_KEYBOARD">USB — types into the scan field</option>
                  <option value="SERIAL">Serial</option>
                </select>
              </label>
            </div>
          </section>

          {/* ── the receipt printer ── */}
          <section className="rows">
            <span className="label">Receipt printer</span>
            <label className="field">
              Receipts print to
              <select value={printerValue} onChange={(event) => choosePrinter(event.target.value)}>
                <option value="NONE">No receipt printer</option>
                <option value="ADDRESS">
                  {config?.printer_host
                    ? `Address in the terminal settings — ${config.printer_host}:${config.printer_port}`
                    : "Address in the terminal settings (not set)"}
                </option>
                {form.printer_id !== null && !chosenListed && (
                  <option value={`RECORDED:${form.printer_id}`}>
                    {form.printer_label ?? form.printer_id} — recorded on the node
                  </option>
                )}
                {(printers ?? []).map((printer) => (
                  <option key={printer.id} value={`RECORDED:${printer.id}`}>
                    {printer.label}
                    {printer.where !== "" ? ` — ${printer.where}` : ""}
                    {printer.purpose !== "RECEIPT" ? " (printer label)" : ""}
                  </option>
                ))}
                <option value="USB">USB printer on this till</option>
              </select>
            </label>
            {session.me === null && (
              <p className="muted" style={{ fontSize: 12 }}>
                Sign in first to choose a network printer recorded on the node.
              </p>
            )}
            {printersProblem !== null && (
              <p className="muted" style={{ fontSize: 12 }}>
                The node's printer list could not be read: {printersProblem}
              </p>
            )}
            {form.receipt_printer === "USB" && (
              <>
                <label className="field">
                  USB printer on this computer
                  <input
                    value={form.usb_printer_name ?? ""}
                    onChange={(event) => change({ usb_printer_name: event.target.value })}
                    placeholder="Printer name as in the system printer list"
                    list="usb-printers"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <datalist id="usb-printers">
                    {(usbPrinters ?? []).map((name) => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>
                </label>
                {usbPrinters !== null && usbPrinters.length > 0 && (
                  <p className="muted" style={{ fontSize: 12 }}>
                    Printers on this computer: {usbPrinters.join(", ")}.
                  </p>
                )}
                {usbProblem !== null && (
                  <p className="muted" style={{ fontSize: 12 }}>
                    This computer's printer list could not be read: {usbProblem}
                  </p>
                )}
                <label className="field">
                  USB printer model
                  <input
                    value={form.usb_printer_model ?? ""}
                    onChange={(event) => change({ usb_printer_model: event.target.value })}
                    placeholder="For example Epson TM-T82"
                    autoComplete="off"
                  />
                </label>
                <div className="notice">
                  The node composes the receipt and this till sends it straight to
                  the printer — on Windows through the spooler as a RAW job, on
                  Mac or Linux through the CUPS queue. The drawer opens with it
                  when it is opened through the printer. Save first, then print a test.
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button
                    className="btn"
                    type="button"
                    disabled={busy}
                    onClick={() => void testUsb()}
                  >
                    <Icon name="print" />
                    Print test
                  </button>
                  {usbTest !== null && (
                    <span className={usbTest.bad ? "error" : "muted"} style={{ fontSize: 12 }}>
                      {usbTest.text}
                    </span>
                  )}
                </div>
              </>
            )}
            <p className="muted" style={{ fontSize: 12 }}>
              Paper width ({config?.paper === "WIDE" ? "80 mm" : "58 mm"}) is set
              in the terminal settings.
            </p>
          </section>

          {/* ── what the node has been told ── */}
          <div className="kv">
            <span className="muted">Report to the node</span>
            {!joined ? (
              <span className="badge plain">Till has not joined — saved here</span>
            ) : held.unsent ? (
              <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span className="badge warn">Not sent</span>
                <button
                  className="btn ghost"
                  type="button"
                  disabled={busy}
                  onClick={() => void resend()}
                >
                  Resend
                </button>
              </span>
            ) : (
              <span className="badge ok">
                Sent{reportedAt !== null ? ` · ${reportedAt}` : ""}
              </span>
            )}
          </div>

          {note !== null && (
            <p className={note.bad ? "error" : "muted"}>{note.text}</p>
          )}

          <div className="action-bar">
            <button className="btn" type="button" onClick={onBack}>
              Back
            </button>
            <button
              className="btn primary"
              type="submit"
              style={{ flex: 1 }}
              disabled={busy}
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </main>
    </div>
  )
}
