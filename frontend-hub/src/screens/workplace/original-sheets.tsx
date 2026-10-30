import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Archive,
  BadgeCheck,
  Building2,
  CarFront,
  ClipboardCheck,
  Copy,
  FileText,
  FilePlus2,
  Landmark,
  ScrollText,
  ShieldCheck,
  UserRound,
} from "lucide-react"
import { useRef, useState } from "react"

import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Day } from "@/components/ui/day"
import { Field, Input } from "@/components/ui/field"
import { FindMany, type Found } from "@/components/ui/find"
import { Choices } from "@/components/ui/form"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { Pill, Status } from "@/components/ui/pill"
import {
  MiniCell,
  MiniRow,
  MiniTable,
  SheetSection,
} from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { SheetEmpty, SheetQuery } from "@/components/ui/sheet-states"
import { today } from "@/lib/calendar"
import { day, EMPTY } from "@/lib/format"
import { gaAssets } from "@/lib/queries/ga"
import {
  attachScan,
  gaRecordKeys,
  originalQuery,
  paperQuery,
  recordPaper,
  registerOriginal,
  releaseOriginal,
  returnOriginal,
  type GaCustodyEvent,
  type GaOriginalHub,
  type GaOriginalRow,
  type GaPaper,
  type GaPaperSubject,
} from "@/lib/queries/ga-records"
import { uploadAttachment } from "@/lib/queries/workplace"
import { useSheet, type SheetKey } from "@/lib/sheets"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"

/// Papers and their physical originals: the sheets Files, the GA Overview and
/// an asset's own sheet all open (owner, 17 Oct 2026).
///
/// # Three objects
///
/// The car is an asset, and its holder is the driver. The BPKB is a paper: a
/// number, what it is about, a scan if there is one. The sheet of paper in the
/// safe is an original: where it is kept, who has it now, until when, and every
/// handover it has had. Lending the BPKB to Sari changes the original's holder
/// and nothing else.
///
/// # How the layers open
///
/// A paper opens as `?paper=` and an original as `?original=`, so either can be
/// sent as a link and a record already in the stack comes back to its layer.
/// `PaperSheet` opens its originals through `?original=`: a screen that shows a
/// `PaperSheet` renders an `OriginalSheet` bound to the same key. Forms (a new
/// paper, a handover, a return) are not records and open from local state.

// ── words ──────────────────────────────────────────────────────────────────

/// The paper types a form offers, as the client writes them on the paper.
/// The papers GA files most, each with the glyph the eye finds first. The
/// value is what is stored (and what Files and the Overview already read); the
/// label is how the hub says it.
const PAPER_TYPES = [
  { value: "BPKB", label: "BPKB", icon: ScrollText },
  { value: "STNK", label: "STNK", icon: CarFront },
  { value: "Sertifikat", label: "Certificate", icon: Landmark },
  { value: "Polis", label: "Policy", icon: ShieldCheck },
  { value: "KIR", label: "KIR", icon: ClipboardCheck },
  { value: "Garansi", label: "Warranty", icon: BadgeCheck },
] as const

/// The tile for "none of those": the type is then typed.
const OTHER = "__other"

/// The glyph a paper wears in a list: its type's, else a plain page.
export function paperIcon(
  docType: string | null
): React.ComponentType<{ className?: string }> {
  return PAPER_TYPES.find((one) => one.value === docType)?.icon ?? FileText
}

const KIND_WORD: Readonly<Record<string, string>> = {
  ORIGINAL: "Original",
  CERTIFIED_COPY: "Certified copy",
}

const EVENT_WORD: Readonly<Record<string, string>> = {
  REGISTERED: "Registered",
  RELEASED: "Released",
  RETURNED: "Returned",
}

/// What the subject kinds are called when a subject has no name of its own.
const SUBJECT_WORD: Readonly<Record<string, string>> = {
  asset: "Asset",
  contract: "Contract",
  location: "Location",
  repair: "Repair",
}

/// Where an original is, in the words a list and a sheet both print: "In
/// Brankas A-02, HO" at home, "With Sari Wulandari · back 30 Oct 2026" out,
/// and the same words in `bad` once it is past its day.
export function originalWords(o: GaOriginalRow): {
  word: string
  tone: "neutral" | "warn" | "bad"
} {
  if (o.status !== "OUT") {
    return { word: `In ${o.storage_location}`, tone: "neutral" }
  }
  const back = o.due_back_on === null ? "" : ` · back ${day(o.due_back_on)}`
  return {
    word: `With ${o.holder_name}${back}`,
    tone: o.overdue ? "bad" : "warn",
  }
}

/// The one status in an original's head.
function standingOf(o: GaOriginalRow): {
  word: string
  tone: "neutral" | "warn" | "bad"
} {
  if (o.status !== "OUT") return { word: "In storage", tone: "neutral" }
  return o.overdue
    ? { word: "Overdue", tone: "bad" }
    : { word: "Out", tone: "warn" }
}

/// "BPKB M-12345678": the crumb under Files, and the words that name a paper
/// when it has no title of its own.
function paperId(
  type: string | null,
  number: string | null
): string | undefined {
  const text = [type, number].filter((part) => part !== null && part !== "")
  return text.length === 0 ? undefined : text.join(" ")
}

/// The form's empty string, as the wire spells "not given".
function blank(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === "" ? null : trimmed
}

/// Where a record a paper is about is shown, as `AppLink` takes it.
function subjectRoute(
  subject: GaPaperSubject
): { to: string; sheet: { key: SheetKey; value: string } } | null {
  switch (subject.kind) {
    case "asset":
      return { to: "/assets", sheet: { key: "asset", value: subject.id } }
    case "contract":
      return { to: "/contracts", sheet: { key: "contract", value: subject.id } }
    case "location":
      return { to: "/locations", sheet: { key: "location", value: subject.id } }
    case "repair":
      return { to: "/maintenance", sheet: { key: "repair", value: subject.id } }
    default:
      return null
  }
}

/// The records a paper is about, one to a line: each opens its own sheet.
function Subjects({ subjects }: { subjects: readonly GaPaperSubject[] }) {
  if (subjects.length === 0) return <>{EMPTY}</>
  return (
    <span className="flex flex-col gap-1">
      {subjects.map((subject) => {
        const name = subject.label ?? SUBJECT_WORD[subject.kind] ?? subject.kind
        const route = subjectRoute(subject)
        return route === null ? (
          <span key={`${subject.kind}:${subject.id}`}>{name}</span>
        ) : (
          <AppLink
            key={`${subject.kind}:${subject.id}`}
            to={route.to}
            sheet={route.sheet}
            className="record-link"
          >
            {name}
          </AppLink>
        )
      })}
    </span>
  )
}

/// A new key every time a form sheet opens, so it starts blank and a failed
/// write of last time is not still on it. The sheet stays mounted for its exit
/// motion; only the form inside is replaced, on the way in.
function useRound(open: boolean): number {
  const [round, setRound] = useState(0)
  const [was, setWas] = useState(open)
  if (open !== was) {
    setWas(open)
    if (open) setRound(round + 1)
  }
  return round
}

/// A label over a control that is not a text box (a segmented switch): a
/// `Field` would make the label press its first segment.
function Labelled({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <span className="field-label text-[0.9375rem] text-mute">{label}</span>
      {children}
    </div>
  )
}

/// Every write here moves papers, originals, the overview and an asset's
/// sections: the GA prefix drops as one, as every GA write does.
function useGaWrite() {
  const client = useQueryClient()
  return () => client.invalidateQueries({ queryKey: gaRecordKeys.all })
}

// ── a new paper ────────────────────────────────────────────────────────────

/// Filing a paper: BPKB, STNK, a policy — with or without its scan, and with
/// its original when it is kept in storage.
export function RecordPaperSheet({
  open,
  onClose,
  subject,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  /// What the paper is about, when the sheet is opened from that record. Left
  /// out, the form asks for an asset.
  subject?: {
    kind: "asset" | "contract" | "location"
    id: string
    label: string
  }
  onSaved?: (paper: GaPaper) => void
}) {
  const round = useRound(open)
  return (
    <PaperForm
      key={round}
      open={open}
      onClose={onClose}
      subject={subject}
      onSaved={onSaved}
    />
  )
}

function PaperForm({
  open,
  onClose,
  subject,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  subject?: { kind: string; id: string; label: string }
  onSaved?: (paper: GaPaper) => void
}) {
  const invalidate = useGaWrite()
  const [type, setType] = useState("")
  const [other, setOther] = useState("")
  const [number, setNumber] = useState("")
  const [title, setTitle] = useState("")
  const [issuer, setIssuer] = useState("")
  const [issuedOn, setIssuedOn] = useState("")
  const [validUntil, setValidUntil] = useState("")
  const [asset, setAsset] = useState<readonly Found[]>([])
  const [kept, setKept] = useState(false)
  const [place, setPlace] = useState("")
  const [problems, setProblems] = useState<Record<string, string>>({})

  const docType = type === OTHER ? other.trim() : type
  const about =
    subject !== undefined
      ? { kind: subject.kind, id: subject.id }
      : asset.length > 0
        ? { kind: "asset", id: asset[0].value }
        : null
  const dirty =
    type !== "" ||
    number !== "" ||
    title !== "" ||
    issuer !== "" ||
    issuedOn !== "" ||
    validUntil !== "" ||
    asset.length > 0 ||
    kept

  const save = useMutation({
    mutationFn: () =>
      recordPaper({
        doc_type: docType,
        doc_number: blank(number),
        title: blank(title),
        issuer: blank(issuer),
        issued_on: issuedOn === "" ? null : issuedOn,
        expires_on: validUntil === "" ? null : validUntil,
        subjects: about === null ? [] : [about],
        original: kept
          ? { kind: "ORIGINAL", storage_location: place.trim() }
          : null,
      }),
    onSuccess: (paper) => {
      void invalidate()
      toast.success("Hard copy saved")
      onSaved?.(paper)
      onClose()
    },
  })

  const submit = () => {
    const next: Record<string, string> = {}
    if (type === "") next.type = "Choose the type of paper."
    else if (docType === "") next.other = "Write what the paper is."
    if (about === null) next.about = "Choose what the paper is about."
    if (kept && place.trim() === "") next.place = "Say where it is kept."
    if (issuedOn !== "" && validUntil !== "" && validUntil < issuedOn) {
      next.validUntil = "A paper cannot run out before it was issued."
    }
    setProblems(next)
    if (Object.keys(next).length > 0) return
    save.mutate()
  }

  const clear = (key: string) =>
    setProblems((current) => ({ ...current, [key]: "" }))

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      size="rail"
      context="Files"
      title="New hard copy"
      dirty={dirty && !save.isSuccess}
      footer={
        <SheetFooter
          error={save.error}
          onCancel={onClose}
          primary={{
            label: "Save hard copy",
            pending: save.isPending,
            onClick: submit,
          }}
        />
      }
    >
      <div className="grid gap-6 sm:grid-cols-2">
        <Labelled label="Paper type" className="sm:col-span-2">
          <Choices
            label="Paper type"
            columns={3}
            className="grid-cols-2"
            value={type}
            invalid={Boolean(problems.type)}
            onChange={(next) => {
              setType(next)
              clear("type")
            }}
            options={[
              ...PAPER_TYPES,
              { value: OTHER, label: "Other", icon: FilePlus2 },
            ]}
          />
          {problems.type ? (
            <span className="text-[0.9375rem] text-bad-fg">
              {problems.type}
            </span>
          ) : null}
        </Labelled>
        <Field label="Number" className="sm:col-span-2">
          <Input
            value={number}
            onChange={(event) => setNumber(event.target.value)}
          />
        </Field>

        {type === OTHER && (
          <Field
            label="What the paper is"
            required
            problem={problems.other || undefined}
            className="sm:col-span-2"
          >
            <Input
              value={other}
              onChange={(event) => {
                setOther(event.target.value)
                clear("other")
              }}
            />
          </Field>
        )}

        <Field label="Title" className="sm:col-span-2">
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <Field label="Issued by" className="sm:col-span-2">
          <Input
            value={issuer}
            onChange={(event) => setIssuer(event.target.value)}
          />
        </Field>
        <Field label="Issued on">
          <Day value={issuedOn} onChange={setIssuedOn} label="Issued on" />
        </Field>
        <Field label="Valid until" problem={problems.validUntil || undefined}>
          <Day
            value={validUntil}
            onChange={(next) => {
              setValidUntil(next)
              clear("validUntil")
            }}
            notBefore={issuedOn === "" ? null : issuedOn}
            label="Valid until"
          />
        </Field>

        <Field
          label="About"
          required
          problem={problems.about || undefined}
          className="sm:col-span-2"
        >
          {subject !== undefined ? (
            <Input value={subject.label} disabled aria-label="About" />
          ) : (
            <FindMany
              chosen={asset}
              // One asset: a second pick replaces the first.
              onChange={(next) => {
                setAsset(next.slice(-1))
                clear("about")
              }}
              queryKey={(needle) => ["ga", "asset-find", needle]}
              search={async (needle, signal) => {
                const page = await gaAssets({ q: needle, limit: 20 }, signal)
                return page.rows.map((row) => ({
                  value: row.asset_id,
                  label: row.name,
                  note: `${row.asset_number} · ${row.class_name}`,
                }))
              }}
              label="The asset this paper is about"
              offline="The asset register is not answering."
            />
          )}
        </Field>

        <div className="flex flex-col gap-6 sm:col-span-2">
          <Labelled label="Original">
            <Choices
              label="Original"
              columns={2}
              className="grid-cols-2"
              value={kept ? "KEPT" : "DETAILS"}
              onChange={(next) => setKept(next === "KEPT")}
              options={[
                { value: "DETAILS", label: "Details only", icon: FileText },
                { value: "KEPT", label: "Kept in storage", icon: Archive },
              ]}
            />
          </Labelled>
          {kept && (
            <Field
              label="Kept in"
              required
              problem={problems.place || undefined}
            >
              <Input
                value={place}
                placeholder="Brankas A-02, HO"
                onChange={(event) => {
                  setPlace(event.target.value)
                  clear("place")
                }}
              />
            </Field>
          )}
        </div>
      </div>
    </Sheet>
  )
}

// ── one original ───────────────────────────────────────────────────────────

/// One physical original: who has it, until when, and every handover.
export function OriginalSheet({
  originalId,
  open,
  onClose,
}: {
  originalId: string | undefined
  open: boolean
  onClose: () => void
}) {
  const hub = useQuery({
    ...originalQuery(originalId ?? ""),
    enabled: open && originalId !== undefined,
  })
  const [releasing, setReleasing] = useState(false)
  const [returning, setReturning] = useState(false)
  const original = hub.data?.original ?? null
  const standing = original === null ? null : standingOf(original)

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(next) => !next && onClose()}
        size="rail"
        stack
        context="Files"
        id={
          original === null
            ? undefined
            : paperId(original.doc_type, original.doc_number)
        }
        title={
          original === null
            ? "Original"
            : `Original · ${original.document_title}`
        }
        badge={
          standing === null ? undefined : (
            <Pill tone={standing.tone} withDot>
              {standing.word}
            </Pill>
          )
        }
        footer={
          original === null ? (
            <SheetFooter onCancel={onClose} cancelLabel="Close" />
          ) : original.status === "OUT" ? (
            <SheetFooter
              primary={{
                label: "Take back",
                onClick: () => setReturning(true),
              }}
            />
          ) : (
            <SheetFooter
              primary={{
                label: "Hand over",
                pendingLabel: "Handing over…",
                onClick: () => setReleasing(true),
              }}
            />
          )
        }
      >
        <SheetQuery query={hub} what="original">
          {(data) => <OriginalBody hub={data} />}
        </SheetQuery>
      </Sheet>

      <ReleaseOriginalSheet
        original={original}
        open={releasing}
        onClose={() => setReleasing(false)}
      />
      <ReturnOriginalSheet
        original={original}
        open={returning}
        onClose={() => setReturning(false)}
      />
    </>
  )
}

function OriginalBody({ hub }: { hub: GaOriginalHub }) {
  const { original, events, subjects, paper } = hub
  const out = original.status === "OUT"
  // The newest handover first.
  const history = [...events].sort(
    (a: GaCustodyEvent, b: GaCustodyEvent) =>
      b.occurred_on.localeCompare(a.occurred_on) ||
      b.recorded_at.localeCompare(a.recorded_at)
  )

  return (
    <>
      <KpiStrip className="mb-2!">
        <Kpi
          label="Held by"
          value={
            <span
              className="block max-w-[11rem] truncate"
              title={original.holder_name}
            >
              {original.holder_kind === "STORAGE"
                ? "Storage"
                : original.holder_name}
            </span>
          }
        />
        <Kpi
          label="Back by"
          value={
            out && original.due_back_on !== null ? (
              <span className={cn(original.overdue && "text-bad-fg")}>
                {day(original.due_back_on)}
              </span>
            ) : (
              EMPTY
            )
          }
        />
        <Kpi
          label="Kept in"
          value={
            <span
              className="block max-w-[11rem] truncate"
              title={original.storage_location}
            >
              {original.storage_location}
            </span>
          }
        />
      </KpiStrip>

      <SheetSection title="Details">
        <Facts>
          <Fact term="Paper">
            <AppLink
              to="/library"
              sheet={{ key: "paper", value: paper.document_id }}
              className="record-link"
            >
              {paper.title}
            </AppLink>
          </Fact>
          <Fact term="Kind">{KIND_WORD[original.kind] ?? original.kind}</Fact>
          <Fact term="About" wide>
            <Subjects subjects={subjects} />
          </Fact>
          {out && original.out_purpose !== null && (
            <Fact term="Purpose" wide>
              {original.out_purpose}
            </Fact>
          )}
        </Facts>
      </SheetSection>

      {original.notes !== null && original.notes !== "" && (
        <SheetSection title="Notes">
          <p className="text-[0.9375rem] text-ink">{original.notes}</p>
        </SheetSection>
      )}

      <SheetSection title="Handovers" aside={history.length}>
        <MiniTable
          head={[
            "Date",
            { label: "What", align: "left" },
            { label: "Who", align: "left" },
            { label: "Purpose", align: "left" },
          ]}
        >
          {history.map((event) => (
            <MiniRow key={event.event_id}>
              <MiniCell className="whitespace-nowrap">
                {day(event.occurred_on)}
              </MiniCell>
              <MiniCell>{EVENT_WORD[event.kind] ?? event.kind}</MiniCell>
              {/* One name per row: who took it out, or who brought it back.
                  Where it went back to is the "Kept in" above. */}
              <MiniCell>
                {event.kind === "RETURNED"
                  ? (event.from_holder ?? event.to_holder)
                  : event.to_holder}
              </MiniCell>
              <MiniCell>{event.purpose ?? EMPTY}</MiniCell>
            </MiniRow>
          ))}
        </MiniTable>
      </SheetSection>
    </>
  )
}

// ── handing an original over, and taking it back ───────────────────────────

/// Hand an original that is in storage to somebody: who, for what, and by when.
export function ReleaseOriginalSheet({
  original,
  open,
  onClose,
}: {
  original: GaOriginalRow | null
  open: boolean
  onClose: () => void
}) {
  const round = useRound(open)
  return (
    <ReleaseForm
      key={round}
      original={original}
      open={open}
      onClose={onClose}
    />
  )
}

function ReleaseForm({
  original,
  open,
  onClose,
}: {
  original: GaOriginalRow | null
  open: boolean
  onClose: () => void
}) {
  const invalidate = useGaWrite()
  const [to, setTo] = useState("")
  const [kind, setKind] = useState<"EMPLOYEE" | "EXTERNAL">("EMPLOYEE")
  const [purpose, setPurpose] = useState("")
  const [backBy, setBackBy] = useState("")
  const [handedOn, setHandedOn] = useState(today())
  const [where, setWhere] = useState("")
  const [problems, setProblems] = useState<Record<string, string>>({})

  const save = useMutation({
    mutationFn: () => {
      if (original === null)
        throw new Error("There is no original to hand over.")
      return releaseOriginal(original.original_id, {
        to_holder: to.trim(),
        holder_kind: kind,
        to_location: blank(where),
        purpose: purpose.trim(),
        due_back_on: backBy === "" ? null : backBy,
        occurred_on: handedOn,
        expected_version: original.version,
      })
    },
    onSuccess: () => {
      void invalidate()
      toast.success("Hard copy handed over")
      onClose()
    },
  })

  const submit = () => {
    const next: Record<string, string> = {}
    if (to.trim() === "") next.to = "Say who receives it."
    if (purpose.trim() === "") next.purpose = "Say why it leaves storage."
    if (handedOn === "") next.handedOn = "Enter the day it leaves."
    if (backBy !== "" && handedOn !== "" && backBy < handedOn) {
      next.backBy = "It cannot be due back before it leaves."
    }
    setProblems(next)
    if (Object.keys(next).length > 0) return
    save.mutate()
  }

  const clear = (key: string) =>
    setProblems((current) => ({ ...current, [key]: "" }))

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      size="rail"
      context="Files"
      id={
        original === null
          ? undefined
          : paperId(original.doc_type, original.doc_number)
      }
      title="Hand over hard copy"
      dirty={(to !== "" || purpose !== "" || where !== "") && !save.isSuccess}
      footer={
        <SheetFooter
          error={save.error}
          onCancel={onClose}
          primary={{
            label: "Hand over",
            pendingLabel: "Handing over…",
            pending: save.isPending,
            onClick: submit,
          }}
        />
      }
    >
      <div className="grid gap-6 sm:grid-cols-2">
        <Field
          label="To"
          required
          problem={problems.to || undefined}
          className="sm:col-span-2"
        >
          <Input
            value={to}
            onChange={(event) => {
              setTo(event.target.value)
              clear("to")
            }}
          />
        </Field>
        <Labelled label="Kind of holder" className="sm:col-span-2">
          <Choices
            label="Kind of holder"
            columns={2}
            className="grid-cols-2"
            options={[
              { value: "EMPLOYEE", label: "Employee", icon: UserRound },
              { value: "EXTERNAL", label: "Outside party", icon: Building2 },
            ]}
            value={kind}
            onChange={setKind}
          />
        </Labelled>
        <Field
          label="Purpose"
          required
          problem={problems.purpose || undefined}
          className="sm:col-span-2"
        >
          <Input
            value={purpose}
            onChange={(event) => {
              setPurpose(event.target.value)
              clear("purpose")
            }}
          />
        </Field>
        <Field
          label="Handed over on"
          required
          problem={problems.handedOn || undefined}
        >
          <Day
            value={handedOn}
            onChange={(next) => {
              setHandedOn(next)
              clear("handedOn")
            }}
            clearable={false}
            required
            label="Handed over on"
          />
        </Field>
        <Field label="Back by" problem={problems.backBy || undefined}>
          <Day
            value={backBy}
            onChange={(next) => {
              setBackBy(next)
              clear("backBy")
            }}
            notBefore={handedOn === "" ? null : handedOn}
            label="Back by"
          />
        </Field>
        <Field label="Where" className="sm:col-span-2">
          <Input
            value={where}
            onChange={(event) => setWhere(event.target.value)}
          />
        </Field>
      </div>
    </Sheet>
  )
}

/// Take an original that is out back into its storage.
export function ReturnOriginalSheet({
  original,
  open,
  onClose,
}: {
  original: GaOriginalRow | null
  open: boolean
  onClose: () => void
}) {
  const round = useRound(open)
  return (
    <ReturnForm key={round} original={original} open={open} onClose={onClose} />
  )
}

function ReturnForm({
  original,
  open,
  onClose,
}: {
  original: GaOriginalRow | null
  open: boolean
  onClose: () => void
}) {
  const invalidate = useGaWrite()
  const [returnedOn, setReturnedOn] = useState(today())
  const [note, setNote] = useState("")
  const [problem, setProblem] = useState("")

  const save = useMutation({
    mutationFn: () => {
      if (original === null)
        throw new Error("There is no original to take back.")
      return returnOriginal(original.original_id, {
        occurred_on: returnedOn,
        note: blank(note),
        expected_version: original.version,
      })
    },
    onSuccess: () => {
      void invalidate()
      toast.success("Original back in storage")
      onClose()
    },
  })

  const submit = () => {
    if (returnedOn === "") {
      setProblem("Enter the day it came back.")
      return
    }
    setProblem("")
    save.mutate()
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      size="rail"
      context="Files"
      id={
        original === null
          ? undefined
          : paperId(original.doc_type, original.doc_number)
      }
      title="Take back original"
      dirty={note !== "" && !save.isSuccess}
      footer={
        <SheetFooter
          error={save.error}
          onCancel={onClose}
          primary={{
            label: "Take back",
            pending: save.isPending,
            onClick: submit,
          }}
        />
      }
    >
      <div className="grid gap-6">
        <Field label="Returned on" required problem={problem || undefined}>
          <Day
            value={returnedOn}
            onChange={(next) => {
              setReturnedOn(next)
              setProblem("")
            }}
            clearable={false}
            required
            label="Returned on"
          />
        </Field>
        <Field label="Note">
          <Input
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
      </div>
    </Sheet>
  )
}

// ── registering the original of a paper already filed ──────────────────────

function RegisterOriginalSheet({
  paper,
  open,
  onClose,
}: {
  paper: GaPaper | null
  open: boolean
  onClose: () => void
}) {
  const round = useRound(open)
  return (
    <RegisterForm key={round} paper={paper} open={open} onClose={onClose} />
  )
}

function RegisterForm({
  paper,
  open,
  onClose,
}: {
  paper: GaPaper | null
  open: boolean
  onClose: () => void
}) {
  const invalidate = useGaWrite()
  const [place, setPlace] = useState("")
  const [kind, setKind] = useState<"ORIGINAL" | "CERTIFIED_COPY">("ORIGINAL")
  const [notes, setNotes] = useState("")
  const [on, setOn] = useState(today())
  const [problem, setProblem] = useState("")

  const save = useMutation({
    mutationFn: () => {
      if (paper === null)
        throw new Error("There is no paper to register it for.")
      return registerOriginal(paper.document_id, {
        kind,
        storage_location: place.trim(),
        notes: blank(notes),
        occurred_on: on === "" ? null : on,
      })
    },
    onSuccess: () => {
      void invalidate()
      toast.success("Original registered")
      onClose()
    },
  })

  const submit = () => {
    if (place.trim() === "") {
      setProblem("Say where it is kept.")
      return
    }
    setProblem("")
    save.mutate()
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      size="rail"
      context="Files"
      id={
        paper === null ? undefined : paperId(paper.doc_type, paper.doc_number)
      }
      title="Add hard copy"
      dirty={(place !== "" || notes !== "") && !save.isSuccess}
      footer={
        <SheetFooter
          error={save.error}
          onCancel={onClose}
          primary={{
            label: "Add hard copy",
            pending: save.isPending,
            onClick: submit,
          }}
        />
      }
    >
      <div className="grid gap-6 sm:grid-cols-2">
        <Field
          label="Kept in"
          required
          problem={problem || undefined}
          className="sm:col-span-2"
        >
          <Input
            value={place}
            placeholder="Brankas A-02, HO"
            onChange={(event) => {
              setPlace(event.target.value)
              setProblem("")
            }}
          />
        </Field>
        <Labelled label="Kind" className="sm:col-span-2">
          <Choices
            label="Kind"
            columns={2}
            className="grid-cols-2"
            options={[
              { value: "ORIGINAL", label: "Original", icon: ScrollText },
              { value: "CERTIFIED_COPY", label: "Certified copy", icon: Copy },
            ]}
            value={kind}
            onChange={setKind}
          />
        </Labelled>
        <Field label="Registered on">
          <Day
            value={on}
            onChange={setOn}
            clearable={false}
            required
            label="Registered on"
          />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <Input
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </Field>
      </div>
    </Sheet>
  )
}

// ── one paper ──────────────────────────────────────────────────────────────

/// One paper: what it says, what it is about, whether it has a scan, and its
/// originals — each of which opens as a layer.
export function PaperSheet({
  documentId,
  open,
  onClose,
}: {
  documentId: string | undefined
  open: boolean
  onClose: () => void
}) {
  const paper = useQuery({
    ...paperQuery(documentId ?? ""),
    enabled: open && documentId !== undefined,
  })
  const invalidate = useGaWrite()
  const [registering, setRegistering] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  // Upload first, attach afterwards: the file is stored through the same
  // route every attachment uses, and the paper then points at it.
  const attach = useMutation({
    mutationFn: async (file: File) => {
      const stored = await uploadAttachment(file)
      return attachScan(documentId ?? "", stored.file_id)
    },
    onSuccess: () => {
      void invalidate()
      toast.success("Scan attached")
    },
  })

  const data = paper.data ?? null
  const expired =
    data !== null && data.expires_on !== null && data.expires_on < today()
  const noScan = data !== null && !data.has_scan
  const noOriginal = data !== null && data.originals.length === 0

  // The foot: the quick verb is the primary (a scan is the usual next step for
  // a paper filed without one); registering an original stands beside it as a
  // ghost, and alone it is the primary.
  const attachButton = (
    <Button
      variant="primary"
      pending={attach.isPending}
      onClick={() => input.current?.click()}
    >
      {attach.isPending ? "Attaching scan…" : "Attach scan"}
    </Button>
  )
  const registerButton = (
    <Button variant="ghost" onClick={() => setRegistering(true)}>
      Add hard copy
    </Button>
  )

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(next) => !next && onClose()}
        size="rail"
        stack
        context="Files"
        id={data === null ? undefined : paperId(data.doc_type, data.doc_number)}
        title={data === null ? "Paper" : data.title}
        badge={
          expired ? (
            <Pill tone="bad" withDot>
              Expired
            </Pill>
          ) : undefined
        }
        footer={
          data === null ? (
            <SheetFooter onCancel={onClose} cancelLabel="Close" />
          ) : noScan ? (
            <SheetFooter
              error={attach.error}
              secondary={noOriginal ? registerButton : undefined}
              primary={attachButton}
            />
          ) : noOriginal ? (
            <SheetFooter
              error={attach.error}
              primary={{
                label: "Add hard copy",
                onClick: () => setRegistering(true),
              }}
            />
          ) : (
            <SheetFooter
              error={attach.error}
              onCancel={onClose}
              cancelLabel="Close"
            />
          )
        }
      >
        <SheetQuery query={paper} what="paper">
          {(one) => <PaperBody paper={one} />}
        </SheetQuery>
        <input
          ref={input}
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            // Cleared so choosing the same file twice in a row still fires.
            event.target.value = ""
            if (file !== undefined) attach.mutate(file)
          }}
        />
      </Sheet>

      <RegisterOriginalSheet
        paper={data}
        open={registering}
        onClose={() => setRegistering(false)}
      />
    </>
  )
}

function PaperBody({ paper }: { paper: GaPaper }) {
  const original = useSheet("original")
  const expired = paper.expires_on !== null && paper.expires_on < today()

  return (
    <>
      <Facts>
        <Fact term="Type">{paper.doc_type ?? EMPTY}</Fact>
        <Fact term="Number">{paper.doc_number ?? EMPTY}</Fact>
        <Fact term="Issued by">{paper.issuer ?? EMPTY}</Fact>
        <Fact term="Issued on">
          {paper.issued_on === null ? EMPTY : day(paper.issued_on)}
        </Fact>
        <Fact term="Valid until">
          {paper.expires_on === null ? (
            "No expiry"
          ) : (
            <span className={cn(expired && "text-bad-fg")}>
              {day(paper.expires_on)}
            </span>
          )}
        </Fact>
        <Fact term="Scan">
          {!paper.has_scan ? (
            "No scan yet"
          ) : (
            <AppLink
              to="/library"
              sheet={{ key: "document", value: paper.document_id }}
              className="record-link"
            >
              {paper.available ? "Filed" : "Filed, file missing"}
            </AppLink>
          )}
        </Fact>
      </Facts>

      <SheetSection title="About">
        <Subjects subjects={paper.subjects} />
      </SheetSection>

      <SheetSection title="Hard copies" aside={paper.originals.length}>
        {paper.originals.length === 0 ? (
          <SheetEmpty>No hard copy is kept.</SheetEmpty>
        ) : (
          <MiniTable
            head={["Original", { label: "Where it is", align: "left" }]}
          >
            {paper.originals.map((one) => {
              const words = originalWords(one)
              return (
                <MiniRow key={one.original_id}>
                  <MiniCell>
                    <button
                      type="button"
                      className="record-link text-left"
                      onClick={() => original.open(one.original_id)}
                    >
                      {KIND_WORD[one.kind] ?? one.kind}
                    </button>
                  </MiniCell>
                  <MiniCell>
                    <Status tone={words.tone}>{words.word}</Status>
                  </MiniCell>
                </MiniRow>
              )
            })}
          </MiniTable>
        )}
      </SheetSection>
    </>
  )
}
