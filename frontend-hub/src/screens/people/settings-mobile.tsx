import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { useState, Suspense } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { useLayout } from "@/lib/layout"
import { Fab } from "@/components/ui/fab"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox, Field, Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { PickOne } from "@/components/ui/pick"
import { KeyValue, MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { Sheet } from "@/components/ui/sheet"
import { EmptyState, Problem } from "@/components/ui/states"
import {
  attendanceSettingKeys,
  removeGeofence,
  saveMobileSetting,
  setGeofence,
  useReachableUnits,
  mobileSettingQuery,
  geofencesQuery,
} from "@/lib/queries/people"
import { useCanWrite } from "@/lib/session"
import {
  CardFoot,
  ListCard,
  RowOpen,
  SheetFooter,
} from "@/screens/people/settings-kit"
import { useOpener } from "@/screens/people/settings-lib"
import type { GeofenceView, MobileAttendanceSetting } from "@itulah/contract"
import { awaiting } from "@/screens/people/awaiting"

/// Settings › Mobile attendance — whether the employee app may punch, whether
/// it must say where it is, and the circle around each unit a phone punch has
/// to come from.
export function MobileSettings() {
  const canWrite = useCanWrite()
  const phone = useLayout() === "phone"
  const units = useReachableUnits()
  const named = new Map((units.data ?? []).map((one) => [one.id, one.name]))

  const edit = useOpener()
  const fence = useOpener<GeofenceView>()

  return (
    <PageContent>
      {canWrite && <Fab label="Add location" onClick={() => fence.show()} />}
      <PageHeader
        crumb="People"
        title="Mobile Attendance"
        sub="Whether the employee app may punch, whether it must say where the phone is, and the circle around each unit a punch must come from."
        actions={
          !phone &&
          canWrite && (
            <>
              <Button onClick={() => edit.show()}>Edit</Button>
              <Button variant="primary" onClick={() => fence.show()}>
                Add location
              </Button>
            </>
          )
        }
      />

      <Card className="mb-4 overflow-hidden">
        <CardHeader>
          <CardTitle>Punching from the employee app</CardTitle>
        </CardHeader>
        <div className="px-4 pb-3">
          {awaiting(mobileSettingQuery(), {
            loading: "Reading the setting…",
            render: (current) => (
              <>
                <KeyValue term="Employees may punch from the app">
                  {current.mobile_enabled ? "Yes" : "No"}
                </KeyValue>
                <KeyValue term="A phone punch must say where the phone was">
                  {current.require_location ? "Yes" : "No"}
                </KeyValue>
                <KeyValue term="A punch from outside the unit's circle is refused">
                  {current.require_geofence ? "Yes" : "No"}
                </KeyValue>
              </>
            ),
          })}
        </div>
        {canWrite && <CardFoot label="Edit" onClick={() => edit.show()} />}
      </Card>

      <ListCard title="Attendance locations">
        {awaiting(geofencesQuery(), {
          loading: "Reading the circles…",
          render: (rows) =>
            rows.length === 0 ? (
              <EmptyState>
                No unit has a circle. Add location draws one to check where
                phone punches come from.
              </EmptyState>
            ) : (
              <MiniTable
                head={["Unit", "Point", { label: "Radius", align: "right" }]}
              >
                {rows.map((row) => (
                  <MiniRow key={row.unit_id}>
                    <MiniCell>
                      {canWrite ? (
                        <RowOpen onClick={() => fence.show(row)}>
                          {named.get(row.unit_id) ?? row.unit_id}
                        </RowOpen>
                      ) : (
                        (named.get(row.unit_id) ?? row.unit_id)
                      )}
                    </MiniCell>
                    <MiniCell>
                      <a
                        className="font-mono text-[0.9375rem] text-accent hover:underline"
                        href={`https://www.google.com/maps?q=${row.latitude},${row.longitude}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {row.latitude.toFixed(5)}, {row.longitude.toFixed(5)}
                      </a>
                    </MiniCell>
                    <MiniCell align="right">{row.radius_m} m</MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            ),
        })}
      </ListCard>

      {/* The sheets start from the setting and the circles in hand, so they
          read them themselves: the buttons need no answer to be pressed. */}
      <Suspense fallback={null}>
        <EditSheetFromSetting
          key={`edit-${edit.n}`}
          open={edit.isOpen}
          onClose={edit.hide}
        />
        <FenceSheetFromFences
          key={`fence-${fence.n}`}
          open={fence.isOpen}
          onClose={fence.hide}
          row={fence.item}
        />
      </Suspense>
    </PageContent>
  )
}

function EditSheetFromSetting({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const setting = useSuspenseQuery(mobileSettingQuery())
  return <EditSheet open={open} onClose={onClose} current={setting.data} />
}

function FenceSheetFromFences({
  open,
  onClose,
  row,
}: {
  open: boolean
  onClose: () => void
  row: GeofenceView | null
}) {
  const fences = useSuspenseQuery(geofencesQuery())
  return (
    <FenceSheet
      open={open}
      onClose={onClose}
      row={row}
      taken={new Set(fences.data.map((one) => one.unit_id))}
    />
  )
}

function EditSheet({
  open,
  onClose,
  current,
}: {
  open: boolean
  onClose: () => void
  current: MobileAttendanceSetting
}) {
  const client = useQueryClient()
  const [enabled, setEnabled] = useState(current.mobile_enabled)
  const [location, setLocation] = useState(current.require_location)
  const [fenced, setFenced] = useState(current.require_geofence)
  const [reason, setReason] = useState("")
  const save = useMutation({
    mutationFn: () =>
      saveMobileSetting({
        mobile_enabled: enabled,
        require_location: location,
        require_geofence: fenced,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: attendanceSettingKeys.mobile(),
      })
      onClose()
    },
  })
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Punching from the employee app"
      footer={
        <SheetFooter
          onCancel={onClose}
          onSave={() => save.mutate()}
          pending={save.isPending}
          disabled={reason.trim() === ""}
        />
      }
    >
      <div className="flex flex-col gap-3.5">
        <Problem error={save.error} />
        <Checkbox
          label="Employees may punch from the app"
          hint="Off: only the station in each unit records a day."
          checked={enabled}
          onChange={setEnabled}
        />
        <Checkbox
          label="A phone punch must say where the phone was"
          checked={location}
          disabled={!enabled}
          onChange={(on) => {
            setLocation(on)
            if (!on) setFenced(false)
          }}
        />
        <Checkbox
          label="Refuse a phone punch from outside the unit's circle"
          hint="Units with no circle drawn are not fenced."
          checked={fenced}
          disabled={!enabled || !location}
          onChange={setFenced}
        />
        <Field label="Why" required>
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
      </div>
    </Sheet>
  )
}

const isNumber = (text: string) =>
  text.trim() !== "" && Number.isFinite(Number(text))

/// One circle. Opened from a row it moves that unit's circle (and can remove
/// it); opened from the header it draws a new one.
function FenceSheet({
  open,
  onClose,
  row,
  taken,
}: {
  open: boolean
  onClose: () => void
  row: GeofenceView | null
  taken: ReadonlySet<string>
}) {
  const client = useQueryClient()
  const units = useReachableUnits()
  const [unit, setUnit] = useState<string | null>(row?.unit_id ?? null)
  const [latitude, setLatitude] = useState(row ? String(row.latitude) : "")
  const [longitude, setLongitude] = useState(row ? String(row.longitude) : "")
  const [radius, setRadius] = useState(row ? String(row.radius_m) : "100")
  const [reason, setReason] = useState("")
  const refresh = () => {
    void client.invalidateQueries({
      queryKey: attendanceSettingKeys.geofences(),
    })
    onClose()
  }
  const save = useMutation({
    mutationFn: () =>
      setGeofence(unit ?? "", {
        latitude: Number(latitude),
        longitude: Number(longitude),
        radius_m: Number(radius),
        reason: reason.trim(),
      }),
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: () => removeGeofence(row?.unit_id ?? ""),
    onSuccess: refresh,
  })
  const name =
    (units.data ?? []).find((one) => one.id === row?.unit_id)?.name ??
    row?.unit_id

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={row ? `${name} — circle` : "Add location"}
      footer={
        <SheetFooter
          onCancel={onClose}
          onSave={() => save.mutate()}
          saveLabel="Submit"
          pending={save.isPending}
          disabled={
            unit === null ||
            !isNumber(latitude) ||
            !isNumber(longitude) ||
            Number(radius) < 10 ||
            reason.trim() === ""
          }
          danger={
            row && (
              <Button
                variant="danger"
                pending={remove.isPending}
                onClick={() => remove.mutate()}
              >
                Remove circle
              </Button>
            )
          }
        />
      }
    >
      <div className="flex flex-col gap-3.5">
        <Problem error={save.error ?? remove.error} />
        {row === null && (
          <Field label="Unit" required>
            <PickOne
              label="Unit"
              choices={(units.data ?? [])
                .filter((one) => !taken.has(one.id))
                .map((one) => ({ value: one.id, label: one.name }))}
              value={unit}
              onChange={setUnit}
            />
          </Field>
        )}
        <Field label="Radius, in metres" aside="10–5,000" required>
          <Input
            inputMode="numeric"
            value={radius}
            onChange={(event) =>
              setRadius(event.target.value.replace(/\D/g, ""))
            }
          />
        </Field>
        <Field label="Latitude" required>
          <Input
            inputMode="decimal"
            value={latitude}
            onChange={(event) => setLatitude(event.target.value)}
          />
        </Field>
        <Field label="Longitude" required>
          <Input
            inputMode="decimal"
            value={longitude}
            onChange={(event) => setLongitude(event.target.value)}
          />
        </Field>
        <Field label="Why" required>
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        <p className="text-[0.9375rem] text-mute">
          Copy the point from a map: in Google Maps, press and hold the
          shop&rsquo;s entrance and copy the two numbers.
        </p>
      </div>
    </Sheet>
  )
}
