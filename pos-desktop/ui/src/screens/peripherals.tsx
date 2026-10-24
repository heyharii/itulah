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
import {
  calibrateReader,
  openCustomerDisplay,
  readerDiagnostics,
  readerProblem,
  readerStatus,
  sentence,
  testReader,
  type Calibration,
  type Fault,
  type PadRead,
  type RadioProfile,
  type ReadSummary,
  type ReaderStatus,
  type ReaderTest,
} from "@/edge"
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
import { FingerprintSection } from "@/screens/fingerprint-enrol"
import { ReaderChip, Topbar } from "@/till"

/// The desk reader every counter has today. Anything else is typed.
const R3 = "Chainway R3"
const OTHER = "__other"

type Printer = {
  readonly id: string
  readonly label: string
  readonly where: string
  readonly purpose: string
}

/// Label and value pairs, one fact a row.
function Facts({ rows }: { rows: readonly (readonly [string, string])[] }) {
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

/// The reader a test ran on and its radio profile, as the shell read them
/// back when it opened the reader (`src-tauri/src/rfid.rs`). Read-only: the
/// shell sets the profile itself on opening and after a reset.
function ReadWith({ firmware, profile }: { firmware: string; profile: RadioProfile }) {
  const rows: readonly (readonly [string, string])[] = [
    ["Firmware", firmware],
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
    ["Region", profile.region ?? "Not read"],
    ["Channels", profile.channels ?? "Not read"],
    ["Antenna mask", profile.antennas ?? "Not read"],
    ["Work / wait", profile.work_wait ?? "Not read"],
  ]
  return <Facts rows={rows} />
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`

/// The check tag in each read: its signal and margin, or not heard.
function checkTagWords(reads: readonly ReadSummary[]): string {
  if (!reads.some((read) => read.canary !== null)) return "None set"
  return reads
    .map((read) =>
      read.canary === null
        ? "—"
        : !read.canary.heard
          ? "not heard"
          : read.canary.rssi_dbm === null || read.canary.margin_db === null
            ? "heard, no signal"
            : `${read.canary.rssi_dbm.toFixed(1)} dBm (${read.canary.margin_db.toFixed(1)} dB)`,
    )
    .join(" · ")
}

/// A fault as the installer reads it here: what happened, the detail, what
/// to do, and the code.
const faultWords = (fault: Fault) =>
  `${fault.says} ${fault.detail} ${fault.action} (${fault.code})`

/// The tags of one read, kept and left out, each with its signal.
function TagLists({ read }: { read: PadRead }) {
  return (
    <>
      {read.tags.length > 0 && (
        <ul className="muted num" style={{ fontSize: 15, margin: 0, paddingLeft: 18 }}>
          {read.tags.map((tag) => (
            <li key={tag.epc}>
              {tag.epc} · {tag.rssi_dbm.toFixed(1)} dBm · read {tag.reads}×
            </li>
          ))}
        </ul>
      )}
      {(read.left_out ?? []).length > 0 && (
        <>
          <span className="muted" style={{ fontSize: 15 }}>
            Left out, below {read.min_rssi_dbm} dBm
          </span>
          <ul className="muted num" style={{ fontSize: 15, margin: 0, paddingLeft: 18 }}>
            {(read.left_out ?? []).map((tag) => (
              <li key={tag.epc}>
                {tag.epc} ·{" "}
                {tag.rssi_dbm === null ? "no signal" : `${tag.rssi_dbm.toFixed(1)} dBm`} ·
                read {tag.reads}×
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}

/// What the Test reader found: PASS or FAIL and why, then the facts support
/// asks for.
function TestResult({ test }: { test: ReaderTest }) {
  const perRead = (count: (read: ReadSummary) => number) =>
    test.reads.length === 0 ? "None" : test.reads.map(count).join(" · ")
  const rows: readonly (readonly [string, string])[] = [
    ["Recipe", test.profile_id],
    ["Open", test.open_ms === null ? "Did not open" : seconds(test.open_ms)],
    [
      "Reads",
      test.reads
        .map((read) => (read.fault !== null ? `failed (${read.fault.code})` : seconds(read.took_ms)))
        .join(" · ") || "None",
    ],
    [
      "Tags per read",
      test.reads.length === 0
        ? "None"
        : `${test.reads.map((read) => read.tags).join(" · ")} · ${
            test.stable ? "the same tags each time" : "not the same tags"
          }`,
    ],
    ["Records per read", perRead((read) => read.records)],
    ["EPCs per read", perRead((read) => read.epcs)],
    [
      "Weakest on the pad",
      test.weakest === null
        ? "None"
        : `${test.weakest.rssi_dbm.toFixed(1)} dBm · …${test.weakest.epc.slice(-8)}`,
    ],
    [
      "Margin to the floor",
      test.margin_db === null
        ? "—"
        : `${test.margin_db.toFixed(1)} dB above ${test.floor_dbm} dBm`,
    ],
    ["Check tag", checkTagWords(test.reads)],
    [
      "Settings",
      `${test.power_dbm} dBm · ${test.window_ms} ms a read · ${test.gap_ms} ms between`,
    ],
  ]
  return (
    <>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
        <span className={test.passed ? "badge ok" : "badge bad"}>
          {test.passed ? "PASS" : "FAIL"}
        </span>
        <span style={{ fontSize: 15 }}>
          {test.reason}
          {test.fault !== null && ` ${test.fault.action} (${test.fault.code})`}
        </span>
      </div>
      <Facts rows={rows} />
      {test.firmware !== null && test.profile !== null && (
        <ReadWith firmware={test.firmware} profile={test.profile} />
      )}
      {test.last !== null && <TagLists read={test.last} />}
    </>
  )
}

/// What Calibrate suggests, saved only when the installer says so.
function CalibrationResult({
  calibration,
  saving,
  onUse,
  onKeep,
}: {
  calibration: Calibration
  saving: boolean
  onUse: (floor: number) => void
  onKeep: () => void
}) {
  const { weakest, strongest_off: off, suggested_dbm: suggested } = calibration
  const rows: readonly (readonly [string, string])[] = [
    [
      "Weakest on the pad",
      weakest === null
        ? "None"
        : `${weakest.rssi_dbm.toFixed(1)} dBm · ${
            weakest.check_tag ? "the check tag" : `…${weakest.epc.slice(-8)}`
          }`,
    ],
    [
      "Strongest off the pad",
      off === null ? "None heard" : `${off.rssi_dbm.toFixed(1)} dBm · …${off.epc.slice(-8)}`,
    ],
    [
      "Tags on the pad",
      `${calibration.on_pad}` +
        (calibration.unsteady > 0 ? ` · ${calibration.unsteady} missed by a read` : ""),
    ],
    ["Floor now", `${calibration.floor_dbm} dBm`],
  ]
  return (
    <>
      <span style={{ fontSize: 15 }}>
        {suggested === null
          ? "No floor to suggest."
          : `Suggested floor ${suggested} dBm: the weakest tag on the pad less 3 dB.`}
      </span>
      <Facts rows={rows} />
      {calibration.warnings.map((fault, at) => (
        <p key={at} className="error" style={{ margin: 0 }}>
          {faultWords(fault)}
        </p>
      ))}
      {suggested !== null && (
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="btn primary"
            type="button"
            disabled={saving}
            onClick={() => onUse(suggested)}
          >
            Use {suggested} dBm
          </button>
          <button className="btn" type="button" disabled={saving} onClick={onKeep}>
            Keep {calibration.floor_dbm} dBm
          </button>
        </div>
      )}
    </>
  )
}

/// Put text on the clipboard: the browser's way, else the old copy command.
async function toClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // The page may not have been given the clipboard: try the old way.
  }
  const area = document.createElement("textarea")
  area.value = text
  area.setAttribute("readonly", "")
  area.style.position = "fixed"
  area.style.opacity = "0"
  document.body.appendChild(area)
  area.select()
  let copied = false
  try {
    copied = document.execCommand("copy")
  } catch {
    copied = false
  }
  area.remove()
  return copied
}

export function PeripheralsScreen({ onBack }: { onBack: () => void }) {
  const session = useSession()
  const { config } = useNodeConfig()
  const [form, setForm] = useState<Peripherals | null>(null)
  const [readerChoice, setReaderChoice] = useState("")
  const [printers, setPrinters] = useState<readonly Printer[] | null>(null)
  const [printersProblem, setPrintersProblem] = useState<string | null>(null)
  const [reader, setReader] = useState<ReaderStatus | null>(null)
  /// The R3 is being tested, calibrated or asked for its diagnostics.
  const [readerBusy, setReaderBusy] = useState(false)
  const [test, setTest] = useState<ReaderTest | null>(null)
  const [calibration, setCalibration] = useState<Calibration | null>(null)
  /// The diagnostics bundle, shown only when the clipboard refused it.
  const [diagnostics, setDiagnostics] = useState<string | null>(null)
  const [readerNote, setReaderNote] = useState<{ bad: boolean; text: string } | null>(null)
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
    setReader(await readerStatus(true))
  }
  useEffect(() => {
    void checkReader()
  }, [])

  /// One of the R3's checks, with the reader held for it: the chip says Busy
  /// meanwhile, and what the shell holds afterwards.
  async function withReader(work: () => Promise<void>) {
    setReaderBusy(true)
    setReaderNote(null)
    try {
      await work()
    } catch (error) {
      setReaderNote({ bad: true, text: readerProblem(error) })
    } finally {
      setReader(await readerStatus(false))
      setReaderBusy(false)
    }
  }

  /// The Test reader, with the settings this till has saved — the shell reads
  /// those, not this form: the R3 opened afresh, its settings read back, three
  /// reads a second apart, and PASS or FAIL.
  const runTest = () =>
    withReader(async () => {
      setTest(null)
      setCalibration(null)
      setTest(await testReader())
    })

  /// Calibrate: three reads of the test items on the pad, and the floor they
  /// suggest — saved only when the installer says so.
  const runCalibrate = () =>
    withReader(async () => {
      setCalibration(null)
      setTest(null)
      setCalibration(await calibrateReader())
    })

  /// The suggested floor, saved over what the shell holds — not over this
  /// form, which may hold other changes nobody saved yet.
  async function saveFloor(floor: number) {
    setBusy(true)
    const saved = await savePeripherals({ ...peripheralsOf(config), r3_min_rssi_dbm: floor })
    setBusy(false)
    if (!saved.ok) {
      setReaderNote({ bad: true, text: saved.problem })
      return
    }
    adoptConfig(saved.value.config)
    setForm((now) => (now === null ? now : { ...now, r3_min_rssi_dbm: floor }))
    setCalibration(null)
    setReaderNote({ bad: false, text: `Floor saved at ${floor} dBm. Test the reader to confirm it.` })
  }

  /// The reader's facts for support, on the clipboard.
  const copyDiagnostics = () =>
    withReader(async () => {
      setDiagnostics(null)
      const text = await readerDiagnostics()
      if (await toClipboard(text)) {
        setReaderNote({
          bad: false,
          text: `Diagnostics copied: ${text.split("\n").length} lines.`,
        })
      } else {
        setDiagnostics(text)
        setReaderNote({ bad: true, text: "The clipboard refused it. Copy the text below." })
      }
    })

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
              <span className="muted" style={{ fontSize: 15 }}>
                {reader === null
                  ? "Checking the reader…"
                  : reader.fault !== null
                    ? sentence(reader.fault)
                    : reader.detail}
              </span>
              <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <ReaderChip status={reader} busy={readerBusy} />
                <button
                  className="btn ghost"
                  type="button"
                  disabled={readerBusy}
                  onClick={() => void checkReader()}
                >
                  Check
                </button>
              </span>
            </div>
            {/* Bench values (README): the weakest kept is what keeps a
                garment that is not on the pad out of the basket; the power
                did not change the reach on the bench R3. */}
            {readerChoice === R3 && (
              <>
                <div style={{ display: "flex", gap: 10 }}>
                  <label className="field" style={{ flex: 1 }}>
                    Profile power (dBm)
                    <input
                      type="number"
                      inputMode="numeric"
                      min={5}
                      max={25}
                      step={1}
                      value={15}
                      readOnly
                    />
                  </label>
                  <label className="field" style={{ flex: 1 }}>
                    Profile read (ms)
                    <input
                      type="number"
                      inputMode="numeric"
                      min={200}
                      max={2000}
                      step={50}
                      value={2000}
                      readOnly
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
                <label className="field">
                  Check tag (EPC)
                  <input
                    value={form.r3_canary_epc ?? ""}
                    onChange={(event) =>
                      change({
                        r3_canary_epc: event.target.value === "" ? null : event.target.value,
                      })
                    }
                    placeholder="A tag fixed at the pad, never sold"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                <p className="muted" style={{ margin: 0 }}>
                  Consistent count: 2 seconds per read, 1 second between reads.
                  Keep all items on the pad and check the result. The signal floor
                  is installation calibration; it cannot guarantee the pad boundary.
                </p>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <button
                    className="btn"
                    type="button"
                    disabled={busy || readerBusy}
                    title="Uses the saved settings. Save first."
                    onClick={() => void runTest()}
                  >
                    <Icon name="rfid" />
                    Test reader
                  </button>
                  <button
                    className="btn"
                    type="button"
                    disabled={busy || readerBusy}
                    title="Put the test items on the pad first."
                    onClick={() => void runCalibrate()}
                  >
                    Calibrate
                  </button>
                  <button
                    className="btn"
                    type="button"
                    disabled={readerBusy}
                    onClick={() => void copyDiagnostics()}
                  >
                    Copy diagnostics
                  </button>
                </div>
                {readerNote !== null && (
                  <span className={readerNote.bad ? "error" : "muted"} style={{ fontSize: 15 }}>
                    {readerNote.text}
                  </span>
                )}
                {test !== null && <TestResult test={test} />}
                {calibration !== null && (
                  <CalibrationResult
                    calibration={calibration}
                    saving={busy}
                    onUse={(floor) => void saveFloor(floor)}
                    onKeep={() => setCalibration(null)}
                  />
                )}
                {diagnostics !== null && (
                  <textarea
                    readOnly
                    value={diagnostics}
                    rows={12}
                    style={{ width: "100%", fontSize: 15, fontFamily: "monospace" }}
                    onFocus={(event) => event.target.select()}
                  />
                )}
              </>
            )}
          </section>

          {/* ── the fingerprint scanner, and enrolling a finger ── */}
          <FingerprintSection />

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
