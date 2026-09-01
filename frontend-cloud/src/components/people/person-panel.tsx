import { AppShell, ScreenHeader, ScreenState } from "@/components/app-shell"
import { Nav } from "@/components/nav"
import { Button } from "@/components/ui/button"
import {
  contractsKey,
  employeeKey,
  personalDataKey,
  readContracts,
  readEmployee,
  readPersonalData,
  statusLabel,
} from "@/lib/employment"
import { cn } from "@/lib/utils"
import type { ContractsView, EmployeeView, PersonalDataView } from "@itulah/contract"
import { ApiError } from "@itulah/contract/client"
import { useQuery } from "@tanstack/react-query"
import { Link, useParams } from "@tanstack/react-router"
import { ArrowLeft, Lock } from "lucide-react"
import { useState } from "react"

type Tab = "employment" | "contracts" | "personal"

/// One person's record.
///
/// Three tabs and three fetches, and the third is the interesting one:
/// personal data is a separate request behind a separate grant, so opening this
/// screen does not fetch a NIK. It is fetched when the tab is opened, and a 403
/// is rendered as an answer — "you may not read this" — rather than as a
/// failure. A supervisor who can see the rota and not the identity documents is
/// the system working, not the system breaking.
export function PersonDetail() {
  const { employeeId } = useParams({ from: "/people/$employeeId" })
  const [tab, setTab] = useState<Tab>("employment")

  const employee = useQuery({
    queryKey: employeeKey(employeeId),
    queryFn: ({ signal }) => readEmployee(employeeId, signal),
  })
  const contracts = useQuery({
    queryKey: contractsKey(employeeId),
    queryFn: ({ signal }) => readContracts(employeeId, signal),
    enabled: tab === "contracts",
  })
  const personal = useQuery({
    queryKey: personalDataKey(employeeId),
    queryFn: ({ signal }) => readPersonalData(employeeId, signal),
    enabled: tab === "personal",
    // A 403 is the server's answer, not a hiccup. Retrying it would produce
    // three identical refusals and a slower screen.
    retry: false,
  })

  const person = employee.data

  return (
    <AppShell nav={<Nav />}>
      <ScreenHeader
        title={person ? person.employee_code : "Person"}
        subtitle={person ? statusLabel(person.status) : "loading…"}
      >
        <Button size="sm" variant="outline" nativeButton={false} render={<Link to="/people" />}>
          <ArrowLeft className="size-3.5" />
          People
        </Button>
      </ScreenHeader>

      <div className="flex gap-0.5 border-b px-3.5">
        {(
          [
            ["employment", "Employment"],
            ["contracts", "Contracts"],
            ["personal", "Personal data"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "border-b-2 px-2.5 py-1.5 text-[11.5px] transition-colors",
              tab === id
                ? "border-foreground font-medium"
                : "text-muted-foreground hover:text-foreground border-transparent",
            )}
          >
            {label}
            {id === "personal" && <Lock className="ml-1 inline size-3 opacity-50" />}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {employee.isPending ? (
          <ScreenState>Loading the record…</ScreenState>
        ) : employee.isError ? (
          <ScreenState
            tone="problem"
            action={
              <Button size="sm" variant="outline" onClick={() => void employee.refetch()}>
                Try again
              </Button>
            }
          >
            {employee.error instanceof ApiError
              ? employee.error.message
              : "The record could not be loaded."}
          </ScreenState>
        ) : !person ? (
          <ScreenState>No such employment record.</ScreenState>
        ) : tab === "employment" ? (
          <Employment person={person} />
        ) : tab === "contracts" ? (
          <Contracts query={contracts} />
        ) : (
          <Personal query={personal} />
        )}
      </div>
    </AppShell>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-1">
      <span className="text-muted-foreground w-32 shrink-0 text-[11px]">{label}</span>
      <span className="text-xs">{children}</span>
    </div>
  )
}

function Employment({ person }: { person: EmployeeView }) {
  return (
    <div className="space-y-5 p-3.5">
      <section>
        <Field label="Number">
          <span className="font-mono">{person.employee_code}</span>
        </Field>
        <Field label="Status">{statusLabel(person.status)}</Field>
        <Field label="Posted at">
          {person.current_place_id ?? (
            <span className="text-muted-foreground">nowhere — unposted</span>
          )}
        </Field>
        <Field label="Selectable">
          {/* Sent by the server rather than derived here, so this screen and
              anything else asking "can they be given work" agree by
              construction. */}
          {person.selectable ? "yes" : "no"}
        </Field>
      </section>

      <section>
        <h2 className="text-muted-foreground mb-1.5 text-[11px] font-medium tracking-wide uppercase">
          What happened, and who decided it
        </h2>
        {person.history.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            Nothing yet — accepted, but not started.
          </p>
        ) : (
          <ol className="space-y-2">
            {person.history.map((event, index) => (
              <li key={index} className="border-l-2 pl-2.5 text-xs">
                <div className="font-medium">
                  {event.transition}
                  <span className="text-muted-foreground font-normal">
                    {" "}
                    · {event.effective_on}
                  </span>
                </div>
                <div className="text-muted-foreground">
                  {event.from} → {event.to} · by {event.actor}
                </div>
                <div className="mt-0.5">{event.reason}</div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {person.assignments.length > 0 && (
        <section>
          <h2 className="text-muted-foreground mb-1.5 text-[11px] font-medium tracking-wide uppercase">
            Where, over time
          </h2>
          <ol className="space-y-1.5">
            {person.assignments.map((span, index) => (
              <li key={index} className="text-xs">
                <span className="font-medium">{span.place_id}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {span.valid_from} → {span.valid_to ?? "still there"}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {person.code_history.length > 0 && (
        <section>
          <h2 className="text-muted-foreground mb-1.5 text-[11px] font-medium tracking-wide uppercase">
            Badge corrections
          </h2>
          {/* Shown because a corrected badge is exactly the kind of change
              somebody later asks about — the identity never moved, only the
              number printed on the card. */}
          <ol className="space-y-1.5">
            {person.code_history.map((correction, index) => (
              <li key={index} className="text-xs">
                <span className="font-mono">{correction.from}</span> →{" "}
                <span className="font-mono">{correction.to}</span>
                <span className="text-muted-foreground"> · by {correction.actor}</span>
                <div className="text-muted-foreground">{correction.reason}</div>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  )
}

function Contracts({
  query,
}: {
  query: { data?: ContractsView; isPending: boolean; isError: boolean; error: unknown }
}) {
  if (query.isPending) return <ScreenState>Loading the contracts…</ScreenState>
  if (query.isError) {
    return (
      <ScreenState tone="problem">
        {query.error instanceof ApiError
          ? query.error.message
          : "The contracts could not be loaded."}
      </ScreenState>
    )
  }
  const view = query.data
  if (!view || view.contracts.length === 0) {
    return <ScreenState>No contract has been signed yet.</ScreenState>
  }

  return (
    <div className="space-y-5 p-3.5">
      {view.pkwt_run && (
        <div className="rounded border px-2.5 py-2 text-xs">
          <div className="font-medium">
            {view.pkwt_run.terms} consecutive fixed term
            {view.pkwt_run.terms === 1 ? "" : "s"}
          </div>
          <div className="text-muted-foreground">
            {view.pkwt_run.from} → {view.pkwt_run.to} · {view.pkwt_run.days} days
          </div>
          {/* Reported, never judged. Whether a run has converted to permanent
              employment by operation of law is a statutory question with real
              consequences, and a screen that guessed at it would be read as an
              answer. */}
          <p className="text-muted-foreground mt-1 text-[11px]">
            Facts only. Whether this run has converted to PKWTT by law is not
            decided here.
          </p>
        </div>
      )}

      <ol className="space-y-2.5">
        {view.contracts.map((contract, index) => (
          <li
            key={index}
            className={cn(
              "border-l-2 pl-2.5 text-xs",
              contract.in_force ? "border-emerald-500" : "border-border",
            )}
          >
            <div className="font-medium">
              {contract.kind} · {contract.position}
              <span className="text-muted-foreground font-normal"> · {contract.grade}</span>
              {contract.in_force && (
                <span className="ml-1.5 text-emerald-600 dark:text-emerald-400">
                  in force
                </span>
              )}
            </div>
            <div className="text-muted-foreground">
              {contract.starts_on} → {contract.ends_on ?? "no end date"}
            </div>
            <div className="text-muted-foreground mt-0.5">
              signed off by {contract.actor} · {contract.reason}
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

function Personal({
  query,
}: {
  query: { data?: PersonalDataView; isPending: boolean; isError: boolean; error: unknown }
}) {
  if (query.isPending) return <ScreenState>Loading…</ScreenState>

  // A refusal is an answer. Rendering it as an error would teach whoever is
  // looking that something is broken, when what has happened is that the system
  // declined to hand a national identity number to somebody who may read a rota.
  if (query.isError) {
    const forbidden = query.error instanceof ApiError && query.error.status === 403
    if (forbidden) {
      return (
        <ScreenState>
          <span className="inline-flex items-center gap-1.5">
            <Lock className="size-3.5" />
            Personal data is a separate permission, and you do not hold it.
          </span>
        </ScreenState>
      )
    }
    const missing = query.error instanceof ApiError && query.error.status === 404
    if (missing) {
      return <ScreenState>No personal data has been recorded for this person.</ScreenState>
    }
    return (
      <ScreenState tone="problem">
        {query.error instanceof ApiError
          ? query.error.message
          : "The record could not be loaded."}
      </ScreenState>
    )
  }

  const data = query.data
  if (!data) return <ScreenState>Nothing recorded.</ScreenState>

  return (
    <div className="space-y-5 p-3.5">
      <section>
        <Field label="Name">{data.full_name}</Field>
        <Field label="NIK">
          <span className="font-mono">{data.nik}</span>
        </Field>
        <Field label="Born">{data.birth_date}</Field>
        <Field label="Address">{data.address}</Field>
        <Field label="Phone">
          {data.phone ?? <span className="text-muted-foreground">—</span>}
        </Field>
        <Field label="Email">
          {data.email ?? <span className="text-muted-foreground">—</span>}
        </Field>
      </section>

      {data.amendments.length > 0 && (
        <section>
          <h2 className="text-muted-foreground mb-1.5 text-[11px] font-medium tracking-wide uppercase">
            What has been changed
          </h2>
          {/* The chain is the authority: the values above are the fold of these
              amendments, and the server refuses to serve a record whose
              amendments do not produce them. */}
          <ol className="space-y-1.5">
            {data.amendments.map((amendment, index) => (
              <li key={index} className="text-xs">
                <span className="font-medium">{amendment.field}</span>
                <span className="text-muted-foreground"> · by {amendment.actor}</span>
                <div className="text-muted-foreground">{amendment.reason}</div>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  )
}
