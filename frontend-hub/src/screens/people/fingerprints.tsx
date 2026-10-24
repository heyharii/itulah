import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { ConfirmButton } from "@/components/ui/dialog"
import { Field, Textarea } from "@/components/ui/field"
import { Choices, type Tile } from "@/components/ui/form"
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { SheetError, SheetLoading } from "@/components/ui/sheet-states"
import { Banner } from "@/components/ui/states"
import {
  captureFinger,
  useScanner,
  type ScannerBridge,
  type ScannerPress,
} from "@/lib/desktop-scanner"
import { day } from "@/lib/format"
import { useNameOfLogin } from "@/lib/queries/hr-employees"
import { headOffice, siteLabel, useUnits } from "@/lib/queries/organisation"
import {
  FINGERS,
  enrolFinger,
  fingerLabel,
  listTerminals,
  peopleKeys,
  punchKeys,
  readEnrolment,
  registerTerminal,
  withdrawFinger,
  type Finger,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { toast } from "@/lib/toast"
import { Quiet } from "@/screens/people/parts"

/// Somebody's enrolled fingers, on their page in People.
///
/// HR enrols them at head office when it registers the person (owner,
/// 24 Oct 2026): on the HR PC, in the Central app, with the ZKTeco scanner
/// plugged in. The template goes up once and is kept sealed at head office,
/// and every store server takes the fingers of the people who sign in there.
/// Which fingers are on file is anybody's who may read the record; enrolling
/// and withdrawing are head office's, and the routes are the permission.
export function FingerprintsPanel({
  employeeId,
  name,
  employer,
  leaver,
}: {
  employeeId: string
  name: string
  employer: boolean
  /// Fingers are erased with a person's employment; a leaver has none to add.
  leaver: boolean
}) {
  const client = useQueryClient()
  const nameOfLogin = useNameOfLogin()
  const offer = employer && !leaver
  const scanner = useScanner(offer)
  const [enrolling, setEnrolling] = useState(false)

  const view = useQuery({
    queryKey: punchKeys.enrolment(employeeId),
    queryFn: ({ signal }) => readEnrolment(employeeId, signal),
  })

  const withdraw = useMutation({
    mutationFn: (ask: { finger: string; reason: string }) =>
      withdrawFinger(employeeId, ask.finger, ask.reason),
    onSuccess: () => {
      // The person's own fingers, and every station count and day that
      // reads whether they can clock in.
      void client.invalidateQueries({ queryKey: punchKeys.all })
      void client.invalidateQueries({
        queryKey: peopleKeys.employee(employeeId),
      })
    },
  })

  return (
    <div className="flex flex-col gap-4">
      {queryState(view, {
        loading: "Reading the fingers…",
        render: (data) =>
          data.fingers.length === 0 ? (
            <Quiet>No finger enrolled.</Quiet>
          ) : (
            <MiniTable
              head={[
                "Finger",
                { label: "Enrolled", align: "left" },
                "By",
                ...(employer ? [""] : []),
              ]}
            >
              {data.fingers.map((row) => (
                <MiniRow key={row.finger}>
                  <MiniCell>{fingerLabel(row.finger)}</MiniCell>
                  <MiniCell>{day(row.enrolled_at)}</MiniCell>
                  <MiniCell align="right">
                    {nameOfLogin(row.enrolled_by)}
                  </MiniCell>
                  {employer && (
                    <MiniCell align="right">
                      <ConfirmButton
                        label="Withdraw"
                        variant="destructive"
                        tone="danger"
                        size="sm"
                        title={`Withdraw ${fingerLabel(row.finger).toLowerCase()}?`}
                        description={
                          data.fingers.length === 1
                            ? `${name} cannot clock in without an enrolled finger.`
                            : undefined
                        }
                        reason={{}}
                        onConfirm={(reason) =>
                          withdraw.mutateAsync({ finger: row.finger, reason })
                        }
                      />
                    </MiniCell>
                  )}
                </MiniRow>
              ))}
            </MiniTable>
          ),
      })}

      {offer && (
        <div className="flex flex-col items-start gap-2">
          <Button
            variant="primary"
            disabled={!scanner.ready}
            onClick={() => setEnrolling(true)}
          >
            Enrol finger
          </Button>
          {scanner.blocked !== null && (
            <p className="text-[0.9375rem] text-mute">{scanner.blocked}</p>
          )}
        </div>
      )}

      {enrolling && scanner.bridge !== null && (
        <EnrolSheet
          employeeId={employeeId}
          name={name}
          enrolled={view.data?.fingers.map((one) => one.finger) ?? []}
          bridge={scanner.bridge}
          onFailed={scanner.recheck}
          onClose={() => setEnrolling(false)}
        />
      )}
    </div>
  )
}

/// The finger the sheet opens on: the first not yet enrolled, index fingers
/// first, which is what a scanner on a desk is pressed with.
const FIRST_ASKED: readonly Finger[] = [
  "RIGHT_INDEX",
  "LEFT_INDEX",
  "RIGHT_THUMB",
  "LEFT_THUMB",
  "RIGHT_MIDDLE",
  "LEFT_MIDDLE",
  "RIGHT_RING",
  "LEFT_RING",
  "RIGHT_LITTLE",
  "LEFT_LITTLE",
]

function firstFree(enrolled: readonly string[]): Finger {
  return FIRST_ASKED.find((one) => !enrolled.includes(one)) ?? "RIGHT_INDEX"
}

/// Pick the finger, press it three times, and it is on file.
///
/// The capture is recorded against HR's desk: the first ACTIVE station at head
/// office, which may enrol anybody (`enrol_finger`). With none registered the
/// same sheet first registers this PC as one, at head office's site. Closing
/// the sheet mid-capture stops the scanner listening.
function EnrolSheet({
  employeeId,
  name,
  enrolled,
  bridge,
  onFailed,
  onClose,
}: {
  employeeId: string
  name: string
  enrolled: readonly string[]
  bridge: ScannerBridge
  onFailed: () => void
  onClose: () => void
}) {
  const client = useQueryClient()
  const units = useUnits()
  const ho = units.data ? headOffice(units.data) : undefined
  const desks = useQuery({
    // `""` while head office is unknown, so the disabled query never reads
    // the every-unit list another screen cached under `null`.
    queryKey: punchKeys.terminals(ho?.id ?? ""),
    queryFn: ({ signal }) => listTerminals(ho!.id, signal),
    enabled: ho !== undefined,
  })
  const desk =
    desks.data?.find(
      (one) => one.status === "ACTIVE" && one.unit_id === ho?.id
    ) ?? null
  const sites = ho?.sites ?? []

  const [site, setSite] = useState("")
  const siteId = sites.length === 1 ? sites[0].id : site
  const [finger, setFinger] = useState<Finger>(() => firstFree(enrolled))
  const [reason, setReason] = useState("")
  const [press, setPress] = useState<ScannerPress | null>(null)
  const [saving, setSaving] = useState(false)

  const scanning = useRef(false)
  useEffect(
    () => () => {
      if (scanning.current) void bridge.cancel()
    },
    [bridge]
  )

  const register = useMutation({
    mutationFn: () =>
      registerTerminal({
        terminalId: `hr-desk-${crypto.randomUUID().slice(0, 8)}`,
        siteId,
        name: "HR desk",
        reason: reason.trim(),
      }),
    onSuccess: (rows) => {
      setReason("")
      // The server answers with head office's stations, the desk among them.
      if (ho !== undefined)
        client.setQueryData(punchKeys.terminals(ho.id), rows)
      void client.invalidateQueries({ queryKey: punchKeys.terminals(null) })
    },
  })

  const enrol = useMutation({
    mutationFn: async (terminalId: string) => {
      setPress(null)
      scanning.current = true
      const captured = await captureFinger(bridge, setPress).finally(() => {
        scanning.current = false
      })
      setSaving(true)
      return enrolFinger(employeeId, {
        finger,
        terminalId,
        templateHex: captured.template_hex,
        quality: captured.quality,
        reason: reason.trim(),
      })
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: punchKeys.all })
      void client.invalidateQueries({
        queryKey: peopleKeys.employee(employeeId),
      })
      toast.success(`${fingerLabel(finger)} enrolled`)
      onClose()
    },
    // An unplugged scanner says so here, and Enrol turns off behind it.
    onError: () => onFailed(),
    onSettled: () => setSaving(false),
  })

  const busy = enrol.isPending || register.isPending
  const fingers: Tile<Finger>[] = FINGERS.map((one) =>
    enrolled.includes(one)
      ? { value: one, label: fingerLabel(one), note: "Enrolled" }
      : { value: one, label: fingerLabel(one) }
  )
  const reasonField = (
    <Field label="Reason" required>
      <Textarea
        rows={2}
        value={reason}
        disabled={busy}
        onChange={(event) => setReason(event.target.value)}
      />
    </Field>
  )

  let body: React.ReactNode
  let footer: React.ReactNode = null
  if (units.isError) {
    body = (
      <SheetError error={units.error} onRetry={() => void units.refetch()} />
    )
  } else if (units.isPending || (ho !== undefined && desks.isPending)) {
    body = <SheetLoading what="stations at head office" />
  } else if (ho === undefined) {
    body = <Banner tone="bad">No head office unit is registered.</Banner>
  } else if (desks.isError) {
    body = (
      <SheetError error={desks.error} onRetry={() => void desks.refetch()} />
    )
  } else if (desk === null) {
    body = (
      <>
        {sites.length === 0 && (
          <Banner tone="bad">
            Head office has no site to register a desk at.
          </Banner>
        )}
        {sites.length > 1 && (
          <Field label="Site" required>
            <Choices
              columns={1}
              options={sites.map((one) => ({
                value: one.id,
                label: siteLabel(ho, one),
              }))}
              value={site}
              onChange={setSite}
              disabled={busy}
            />
          </Field>
        )}
        {reasonField}
      </>
    )
    footer = (
      <SheetFooter
        note="Head office has no HR desk yet."
        error={register.error}
        primary={{
          label: "Register this PC as HR desk",
          pending: register.isPending,
          disabled: siteId === "" || reason.trim() === "",
          onClick: () => register.mutate(),
        }}
      />
    )
  } else {
    body = (
      <>
        <Field label="Finger" required>
          <Choices
            options={fingers}
            value={finger}
            onChange={setFinger}
            disabled={busy}
          />
        </Field>
        {reasonField}
      </>
    )
    footer = (
      <SheetFooter
        note={
          enrol.isPending
            ? (press?.message ?? "Press the finger on the scanner three times.")
            : undefined
        }
        error={enrol.isPending ? null : enrol.error}
        primary={{
          label: "Scan finger",
          pending: enrol.isPending,
          pendingLabel: saving ? "Enrolling…" : "Scanning…",
          disabled: reason.trim() === "",
          onClick: () => enrol.mutate(desk.id),
        }}
      />
    )
  }

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="Enrol finger"
      context={name}
      stack
      footer={footer}
    >
      {body}
    </Sheet>
  )
}
