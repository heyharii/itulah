import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox, Field, Input } from "@/components/ui/field"
import { PickOne } from "@/components/ui/pick"
import { MiniCell, MiniRow, MiniTable, SubHead } from "@/components/ui/rows"
import { Banner, EmptyState } from "@/components/ui/states"
import {
  attendanceSettingKeys,
  geofences,
  mobileSetting,
  removeGeofence,
  saveMobileSetting,
  setGeofence,
  useReachableUnits,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import type { MobileAttendanceSetting } from "@itulah/contract"

/// Talenta's mobile attendance settings and attendance locations: whether the
/// employee app may punch, whether it must say where it is, and the circle
/// around each unit a phone punch has to come from.
export function MobileAttendance() {
  return (
    <>
      <MobileCard />
      <FencesCard />
    </>
  )
}

function MobileCard() {
  const setting = useQuery({
    queryKey: attendanceSettingKeys.mobile(),
    queryFn: ({ signal }) => mobileSetting(signal),
  })
  return (
    <Card className="mt-4 mb-4">
      <CardHeader>
        <CardTitle>Punching from the employee app</CardTitle>
      </CardHeader>
      <div className="px-4 pb-4">
        {queryState(setting, {
          loading: "Reading the setting…",
          render: (current) => <MobileForm current={current} />,
        })}
      </div>
    </Card>
  )
}

function MobileForm({ current }: { current: MobileAttendanceSetting }) {
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
      setReason("")
      void client.invalidateQueries({
        queryKey: attendanceSettingKeys.mobile(),
      })
    },
  })
  return (
    <div className="flex flex-col gap-3">
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
        hint="Units with no circle drawn below are not fenced."
        checked={fenced}
        disabled={!enabled || !location}
        onChange={setFenced}
      />
      <Field label="Why" required>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      {save.error !== null && <Banner tone="bad">{save.error.message}</Banner>}
      <div>
        <Button
          variant="primary"
          pending={save.isPending}
          disabled={reason.trim() === ""}
          onClick={() => save.mutate()}
        >
          Save
        </Button>
      </div>
    </div>
  )
}

function FencesCard() {
  const client = useQueryClient()
  const fences = useQuery({
    queryKey: attendanceSettingKeys.geofences(),
    queryFn: ({ signal }) => geofences(signal),
  })
  const units = useReachableUnits()
  const [unit, setUnit] = useState<string | null>(null)
  const [latitude, setLatitude] = useState("")
  const [longitude, setLongitude] = useState("")
  const [radius, setRadius] = useState("100")
  const [reason, setReason] = useState("")
  const refresh = () =>
    client.invalidateQueries({ queryKey: attendanceSettingKeys.geofences() })
  const save = useMutation({
    mutationFn: () =>
      setGeofence(unit ?? "", {
        latitude: Number(latitude),
        longitude: Number(longitude),
        radius_m: Number(radius),
        reason: reason.trim(),
      }),
    onSuccess: () => {
      setUnit(null)
      setLatitude("")
      setLongitude("")
      setRadius("100")
      setReason("")
      void refresh()
    },
  })
  const remove = useMutation({
    mutationFn: (one: string) => removeGeofence(one),
    onSuccess: () => void refresh(),
  })
  const named = new Map((units.data ?? []).map((one) => [one.id, one.name]))
  const number = (text: string) =>
    text.trim() !== "" && Number.isFinite(Number(text))

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Attendance locations</CardTitle>
      </CardHeader>
      <div className="flex flex-col gap-4 px-4 pb-4">
        {queryState(fences, {
          loading: "Reading the circles…",
          render: (rows) =>
            rows.length === 0 ? (
              <EmptyState>
                No unit has a circle. Draw one to check where phone punches come
                from.
              </EmptyState>
            ) : (
              <MiniTable
                head={[
                  "Unit",
                  "Point",
                  { label: "Radius", align: "right" },
                  "",
                ]}
              >
                {rows.map((row) => (
                  <MiniRow key={row.unit_id}>
                    <MiniCell>
                      <button
                        type="button"
                        className="text-left hover:underline"
                        onClick={() => {
                          setUnit(row.unit_id)
                          setLatitude(String(row.latitude))
                          setLongitude(String(row.longitude))
                          setRadius(String(row.radius_m))
                        }}
                      >
                        {named.get(row.unit_id) ?? row.unit_id}
                      </button>
                    </MiniCell>
                    <MiniCell>
                      <a
                        className="font-mono text-[0.875rem] text-accent hover:underline"
                        href={`https://www.google.com/maps?q=${row.latitude},${row.longitude}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {row.latitude.toFixed(5)}, {row.longitude.toFixed(5)}
                      </a>
                    </MiniCell>
                    <MiniCell align="right">{row.radius_m} m</MiniCell>
                    <MiniCell>
                      <Button
                        variant="quiet"
                        pending={remove.isPending}
                        onClick={() => remove.mutate(row.unit_id)}
                      >
                        Remove
                      </Button>
                    </MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            ),
        })}
        <SubHead aside="Click a row to move its circle">Draw a circle</SubHead>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Unit" required>
            <PickOne
              label="Unit"
              placeholder="Choose a unit…"
              choices={(units.data ?? []).map((one) => ({
                value: one.id,
                label: one.name,
              }))}
              value={unit}
              onChange={setUnit}
            />
          </Field>
          <Field label="Radius, in metres" aside="10–5,000" required>
            <Input
              inputMode="numeric"
              value={radius}
              onChange={(e) => setRadius(e.target.value.replace(/\D/g, ""))}
            />
          </Field>
          <Field label="Latitude" required>
            <Input
              inputMode="decimal"
              value={latitude}
              onChange={(e) => setLatitude(e.target.value)}
              placeholder="-6.20000"
            />
          </Field>
          <Field label="Longitude" required>
            <Input
              inputMode="decimal"
              value={longitude}
              onChange={(e) => setLongitude(e.target.value)}
              placeholder="106.80000"
            />
          </Field>
          <Field label="Why" required>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
        <p className="text-[0.875rem] text-mute">
          Copy the point from a map: in Google Maps, press and hold the
          shop&rsquo;s entrance and copy the two numbers.
        </p>
        {(save.error ?? remove.error) !== null && (
          <Banner tone="bad">{(save.error ?? remove.error)?.message}</Banner>
        )}
        <div>
          <Button
            variant="primary"
            pending={save.isPending}
            disabled={
              unit === null ||
              !number(latitude) ||
              !number(longitude) ||
              Number(radius) < 10 ||
              reason.trim() === ""
            }
            onClick={() => save.mutate()}
          >
            Save circle
          </Button>
        </div>
      </div>
    </Card>
  )
}
