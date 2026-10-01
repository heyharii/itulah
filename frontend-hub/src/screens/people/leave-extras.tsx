import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Day } from "@/components/ui/day"
import { Field, Input } from "@/components/ui/field"
import { PickOne } from "@/components/ui/pick"
import { Pill } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable, SubHead } from "@/components/ui/rows"
import { Banner, EmptyState } from "@/components/ui/states"
import { day, money } from "@/lib/format"
import {
  blockLeave,
  encashLeave,
  leaveBalances,
  leaveBlackouts,
  leaveEncashments,
  leaveExtraKeys,
  leaveKeys,
  liftLeaveBlock,
  recordHolidayWork,
  useReachableUnits,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { usePeopleAudience } from "@/screens/people/scope"

/// Blok tanggal cuti: dates head office closes to leave — for every unit or
/// one. A request that would charge a closed date is refused at filing.
export function BlockedDatesCard() {
  const client = useQueryClient()
  const blocks = useQuery({
    queryKey: leaveExtraKeys.blackouts(),
    queryFn: ({ signal }) => leaveBlackouts(signal),
  })
  const units = useReachableUnits()
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [unit, setUnit] = useState<string | null>(null)
  const [reason, setReason] = useState("")
  const [liftWhy, setLiftWhy] = useState("")
  const refresh = () =>
    client.invalidateQueries({ queryKey: leaveExtraKeys.blackouts() })
  const block = useMutation({
    mutationFn: () =>
      blockLeave({
        from_date: from,
        to_date: to,
        unit_id: unit,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      setFrom("")
      setTo("")
      setUnit(null)
      setReason("")
      void refresh()
    },
  })
  const lift = useMutation({
    mutationFn: (id: string) => liftLeaveBlock(id, liftWhy.trim()),
    onSuccess: () => {
      setLiftWhy("")
      void refresh()
    },
  })
  const named = new Map((units.data ?? []).map((one) => [one.id, one.name]))

  return (
    <Card className="mt-4 mb-4">
      <CardHeader>
        <CardTitle>Dates closed to leave</CardTitle>
      </CardHeader>
      <div className="flex flex-col gap-4 px-4 pb-4">
        {queryState(blocks, {
          loading: "Reading the closed dates…",
          render: (rows) =>
            rows.length === 0 ? (
              <EmptyState>
                No date is closed. Close the Lebaran rush or stock-take week so
                nobody can take leave on them.
              </EmptyState>
            ) : (
              <MiniTable head={["Dates", "Where", "Why", ""]}>
                {rows.map((row) => (
                  <MiniRow key={row.id}>
                    <MiniCell>
                      {day(row.from_date)} – {day(row.to_date)}
                    </MiniCell>
                    <MiniCell>
                      {row.unit_id === null
                        ? "Every unit"
                        : (named.get(row.unit_id) ?? row.unit_id)}
                    </MiniCell>
                    <MiniCell>{row.reason}</MiniCell>
                    <MiniCell>
                      {row.lifted ? (
                        <Pill tone="neutral">Lifted</Pill>
                      ) : (
                        <Button
                          variant="quiet"
                          disabled={liftWhy.trim() === ""}
                          pending={lift.isPending}
                          onClick={() => lift.mutate(row.id)}
                        >
                          Lift
                        </Button>
                      )}
                    </MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            ),
        })}
        <Field label="Why lift one" aside="asked before Lift">
          <Input value={liftWhy} onChange={(e) => setLiftWhy(e.target.value)} />
        </Field>
        <SubHead>Close dates</SubHead>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="From" required>
            <Day value={from} onChange={setFrom} />
          </Field>
          <Field label="To" required>
            <Day value={to} onChange={setTo} />
          </Field>
          <Field label="Where">
            <PickOne
              label="Where"
              placeholder="Every unit"
              choices={(units.data ?? []).map((one) => ({
                value: one.id,
                label: one.name,
              }))}
              value={unit}
              onChange={setUnit}
            />
          </Field>
          <Field label="Why" required>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="stock opname"
            />
          </Field>
        </div>
        {(block.error ?? lift.error) !== null && (
          <Banner tone="bad">{(block.error ?? lift.error)?.message}</Banner>
        )}
        <div>
          <Button
            variant="primary"
            pending={block.isPending}
            disabled={from === "" || to === "" || reason.trim() === ""}
            onClick={() => block.mutate()}
          >
            Close these dates
          </Button>
        </div>
      </div>
    </Card>
  )
}

function thisMonth(): string {
  return new Date().toISOString().slice(0, 7)
}

/// Uangkan cuti and Kerja di hari libur, on one person's Leave tab: days
/// paid out into a month's payroll, and a day earned back for a holiday or a
/// rest day worked.
export function LeaveMoves({ employeeId }: { employeeId: string }) {
  // Head office's: paying days out is a wage and a holiday worked is a grant,
  // and a manager would only be shown forms the server refuses.
  const employer = usePeopleAudience() === "employer"
  const client = useQueryClient()
  const balances = useQuery({
    queryKey: leaveKeys.balances(employeeId),
    queryFn: ({ signal }) => leaveBalances(employeeId, signal),
  })
  const encashments = useQuery({
    queryKey: leaveExtraKeys.encashments(employeeId),
    queryFn: ({ signal }) => leaveEncashments(employeeId, signal),
  })
  const kinds = (balances.data ?? []).map((row) => ({
    value: row.leave_type,
    label: row.name,
  }))
  const [kind, setKind] = useState<string | null>(null)
  const [days, setDays] = useState("")
  const [period, setPeriod] = useState(thisMonth)
  const [divisor, setDivisor] = useState("25")
  const [why, setWhy] = useState("")
  const [workedOn, setWorkedOn] = useState("")
  const [workedWhy, setWorkedWhy] = useState("")
  const chosen = kind ?? kinds[0]?.value ?? null
  const refresh = () => {
    void client.invalidateQueries({ queryKey: leaveKeys.balances(employeeId) })
    void client.invalidateQueries({
      queryKey: leaveExtraKeys.encashments(employeeId),
    })
  }
  const encash = useMutation({
    mutationFn: () =>
      encashLeave(employeeId, {
        leave_type: chosen ?? "",
        days: Number(days.replace(",", ".")),
        period,
        divisor_days: divisor.trim() === "" ? null : Number(divisor),
        reason: why.trim(),
      }),
    onSuccess: () => {
      setDays("")
      setWhy("")
      refresh()
    },
  })
  const worked = useMutation({
    mutationFn: () =>
      recordHolidayWork(employeeId, {
        on_date: workedOn,
        leave_type: chosen ?? "",
        days: 1,
        reason: workedWhy.trim(),
      }),
    onSuccess: () => {
      setWorkedOn("")
      setWorkedWhy("")
      refresh()
    },
  })

  if (!employer) return null

  return (
    <div className="flex flex-col gap-5">
      <div>
        <SubHead>Pay days out</SubHead>
        {queryState(encashments, {
          loading: "Reading the payouts…",
          render: (rows) =>
            rows.length === 0 ? null : (
              <MiniTable
                head={[
                  "Month",
                  "Days",
                  { label: "Paid", align: "right" },
                  "By",
                ]}
              >
                {rows.map((row) => (
                  <MiniRow key={row.id}>
                    <MiniCell>{row.period}</MiniCell>
                    <MiniCell>{row.centidays / 100}</MiniCell>
                    <MiniCell align="right">
                      {money(row.amount_minor)}
                      <span className="block text-[0.875rem] text-mute">
                        {money(row.wage_minor)} ÷ {row.divisor_days} a day
                      </span>
                    </MiniCell>
                    <MiniCell>{row.encashed_by}</MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            ),
        })}
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Kind" required>
            <PickOne
              label="Kind"
              placeholder="Choose…"
              choices={kinds}
              value={chosen}
              onChange={setKind}
            />
          </Field>
          <Field label="Days" required>
            <Input
              inputMode="decimal"
              value={days}
              onChange={(e) => setDays(e.target.value)}
              placeholder="2"
            />
          </Field>
          <Field label="Paid with the payroll of" required>
            <Input
              type="month"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
            />
          </Field>
          <Field label="A day is the month's wage over" aside="days">
            <Input
              inputMode="numeric"
              value={divisor}
              onChange={(e) => setDivisor(e.target.value.replace(/\D/g, ""))}
            />
          </Field>
          <Field label="Why" required>
            <Input value={why} onChange={(e) => setWhy(e.target.value)} />
          </Field>
        </div>
        {encash.error !== null && (
          <Banner tone="bad" className="mt-2">
            {encash.error.message}
          </Banner>
        )}
        <div className="mt-3">
          <Button
            variant="ghost"
            pending={encash.isPending}
            disabled={
              chosen === null ||
              !(Number(days.replace(",", ".")) > 0) ||
              why.trim() === ""
            }
            onClick={() => encash.mutate()}
          >
            Pay out
          </Button>
        </div>
      </div>

      <div>
        <SubHead>A holiday or rest day worked</SubHead>
        <p className="mb-2 text-[0.875rem] text-mute">
          Earns one day back into the kind chosen above. The day must be a
          public holiday or a rest day on their roster.
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Day worked" required>
            <Day value={workedOn} onChange={setWorkedOn} />
          </Field>
          <Field label="Why" required>
            <Input
              value={workedWhy}
              onChange={(e) => setWorkedWhy(e.target.value)}
              placeholder="jaga toko saat libur"
            />
          </Field>
        </div>
        {worked.error !== null && (
          <Banner tone="bad" className="mt-2">
            {worked.error.message}
          </Banner>
        )}
        <div className="mt-3">
          <Button
            variant="ghost"
            pending={worked.isPending}
            disabled={
              chosen === null || workedOn === "" || workedWhy.trim() === ""
            }
            onClick={() => worked.mutate()}
          >
            Give the day back
          </Button>
        </div>
      </div>
    </div>
  )
}
