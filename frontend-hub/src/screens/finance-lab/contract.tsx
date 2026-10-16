import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { PageHeader } from "@/components/ui/page-header"
import { Segmented } from "@/components/ui/segmented"
import { Tag } from "@/components/ui/tag"
import { cn } from "@/lib/utils"
import { BANK_ACCOUNTS, BINDINGS } from "@/screens/finance-lab/engine/bindings"
import { account } from "@/screens/finance-lab/engine/chart"
import { PACKAGES } from "@/screens/finance-lab/engine/rules"
import {
  Blocked,
  Cell,
  EvidenceTag,
  ReadinessTag,
  Row,
  Section,
  Table,
} from "@/screens/finance-lab/parts"
import type {
  AccountRole,
  RulePackage,
} from "@/screens/finance-lab/engine/types"

/// The contract itself, on a screen: rules, roles and the map into the chart.
///
/// # Why the rules that are OFF are the most useful rows here
///
/// A matrix that lists every rule as LOCKED tells a reader nothing about which
/// ones may actually run. Three of the fourteen packages below are off, and
/// each one is off for a different kind of reason — no evidence, evidence that
/// contradicts the design, and a policy change nobody approved. Those three are
/// the honest state of this system's accounting, and they are the rows a person
/// should leave this screen remembering.

/// Every role a rule may name. Read from the packages so the list cannot go
/// stale against them.
function rolesInUse(): readonly AccountRole[] {
  const set = new Set<AccountRole>()
  for (const p of PACKAGES) for (const l of p.lines) set.add(l.role)
  return [...set].sort()
}

export function LabContract() {
  const [tab, setTab] = useState<"rules" | "roles" | "map">("rules")
  const roles = useMemo(rolesInUse, [])
  const bound = useMemo(() => new Set(BINDINGS.map((b) => b.role)), [])
  const unbound = roles.filter((r) => !bound.has(r))

  const active = PACKAGES.filter((p) => p.activation.enabled)
  const off = PACKAGES.filter((p) => !p.activation.enabled)

  return (
    <PageContent>
      <PageHeader
        crumb="Finance"
        title="Kontrak"
        actions={
          <div className="flex items-center gap-2">
            <Segmented
              value={tab}
              onChange={setTab}
              options={[
                { value: "rules", label: `Rule ${PACKAGES.length}` },
                { value: "roles", label: `Role ${roles.length}` },
                { value: "map", label: `Peta ${BINDINGS.length}` },
              ]}
            />
          </div>
        }
      />

      {tab === "rules" && (
        <>
          {off.length > 0 && (
            <Section title={`${off.length} rules not enabled`}>
              <div className="space-y-2">
                {off.map((p) => (
                  <Blocked key={p.package_id}>
                    <span className="font-mono text-[0.9375rem] font-semibold">
                      {p.package_id}@{p.version}
                    </span>{" "}
                    — {p.title}
                    <div className="mt-1">{p.activation.blocked_reason}</div>
                    <div className="mt-1 text-[0.9375rem] opacity-90">
                      {p.evidence.note}
                    </div>
                  </Blocked>
                ))}
              </div>
            </Section>
          )}

          <Section title={`${active.length} aturan aktif`}>
            <div className="space-y-3">
              {active.map((p) => (
                <RuleCard key={p.package_id} pkg={p} />
              ))}
            </div>
          </Section>
        </>
      )}

      {tab === "roles" && (
        <>
          {unbound.length === 0 && (
            <Section title="Role tanpa binding">
              <>
                <p className="px-3.5 py-3 text-[0.9375rem] text-ok-fg">
                  Every role a rule uses has a binding.
                </p>
              </>
            </Section>
          )}

          <Section title="Roles and the accounts that answer them">
            <>
              <Table
                head={["Role", ">Binding", "Example Account", "Narrowed by"]}
              >
                {roles.map((r) => {
                  const bs = BINDINGS.filter((b) => b.role === r)
                  const narrows = new Set<string>()
                  for (const b of bs)
                    for (const k of Object.keys(b.narrows))
                      if (k !== "unit_id") narrows.add(k)
                  return (
                    <Row key={r} tone={bs.length === 0 ? "bad" : undefined}>
                      <Cell mono>{r}</Cell>
                      <Cell right>{bs.length}</Cell>
                      <Cell>
                        {bs[0] ? (
                          <>
                            <span className="font-mono text-[0.9375rem] text-mute">
                              {bs[0].account_code}
                            </span>
                            <div>{account(bs[0].account_code)?.name}</div>
                          </>
                        ) : (
                          <span className="text-bad-fg">none</span>
                        )}
                      </Cell>
                      <Cell>
                        {narrows.size === 0 ? (
                          <span className="text-mute">unit saja</span>
                        ) : (
                          [...narrows].map((n) => (
                            <Tag key={n} className="mr-1">
                              {n}
                            </Tag>
                          ))
                        )}
                      </Cell>
                    </Row>
                  )
                })}
              </Table>
            </>
          </Section>
        </>
      )}

      {tab === "map" && (
        <>
          <Section title="Bank accounts terdaftar">
            <>
              <Table head={["Identitas", "Bank", "Product", "Number", "Unit"]}>
                {BANK_ACCOUNTS.map((a) => (
                  <Row key={a.bank_account_id}>
                    <Cell mono>{a.bank_account_id}</Cell>
                    <Cell>{a.bank}</Cell>
                    <Cell>
                      <Tag tone={a.product === "GIRO" ? "info" : "neutral"}>
                        {a.product}
                      </Tag>
                    </Cell>
                    <Cell className="text-mute">{a.number_masked}</Cell>
                    <Cell>{a.unit_id}</Cell>
                  </Row>
                ))}
              </Table>
            </>
          </Section>

          <Section
            title="Binding"
            sub="Every line carries an effective date and a version."
          >
            <>
              <Table
                head={[
                  "Role",
                  "Narrowed by",
                  "Account",
                  "Valid from",
                  "Version",
                ]}
              >
                {BINDINGS.map((b) => (
                  <Row key={b.binding_id}>
                    <Cell mono>{b.role}</Cell>
                    <Cell>
                      {Object.entries(b.narrows)
                        .filter(([k]) => k !== "unit_id")
                        .map(([k, v]) => (
                          <Tag key={k} className="mr-1">
                            {k}={String(v)}
                          </Tag>
                        ))}
                      <span className="ml-1 text-mute">
                        {b.narrows.unit_id}
                      </span>
                    </Cell>
                    <Cell>
                      <span className="font-mono text-[0.9375rem] text-mute">
                        {b.account_code}
                      </span>
                      <div>
                        {account(b.account_code)?.name ?? (
                          <span className="text-bad-fg">none di bagan</span>
                        )}
                      </div>
                    </Cell>
                    <Cell>{b.valid_from}</Cell>
                    <Cell right>{b.version}</Cell>
                  </Row>
                ))}
              </Table>
            </>
          </Section>
        </>
      )}
    </PageContent>
  )
}

function RuleCard({ pkg }: { pkg: RulePackage }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="hover:bg-soft-1 flex w-full flex-wrap items-baseline gap-x-2.5 gap-y-1 px-3.5 py-2.5 text-left"
      >
        <span className="font-mono text-[0.9375rem] font-semibold text-ink">
          {pkg.package_id}@{pkg.version}
        </span>
        <span className="text-[0.9375rem] text-ink">{pkg.title}</span>
        <span className="ml-auto flex items-center gap-1.5">
          <Tag tone="accent">{pkg.mode}</Tag>
          <EvidenceTag evidence={pkg.evidence} />
          <ReadinessTag readiness={pkg.readiness} />
        </span>
      </button>
      {open && (
        <div className="border-t border-hairline px-3.5 py-3">
          <p className="mb-3 text-[0.9375rem] text-body">
            <span className="font-medium text-ink">Receipt: </span>
            {pkg.evidence.kind === "ACTUAL_JOURNAL" && (
              <span className="font-mono text-[0.9375rem]">
                {pkg.evidence.document} —{" "}
              </span>
            )}
            {pkg.evidence.note}
          </p>
          <Table
            head={["#", "Side", "Role", "Narrowed by", "Base", "Alternative"]}
          >
            {pkg.lines.map((l) => (
              <Row key={l.seq}>
                <Cell>{l.seq}</Cell>
                <Cell>
                  <Tag tone={l.side === "DEBIT" ? "info" : "warn"}>
                    {l.side}
                  </Tag>
                </Cell>
                <Cell mono>{l.role}</Cell>
                <Cell className="text-mute">{l.narrow_by.join(", ")}</Cell>
                <Cell className="text-mute">
                  {l.basis.kind === "FIELD"
                    ? `field ${l.basis.field}`
                    : l.basis.kind === "PER"
                      ? `per ${l.basis.group}.${l.basis.field}`
                      : l.basis.kind === "SUM"
                        ? `sum ${l.basis.group}.${l.basis.field}`
                        : "penyeimbang"}
                </Cell>
                <Cell>{l.alt_group ? <Tag>{l.alt_group}</Tag> : "—"}</Cell>
              </Row>
            ))}
          </Table>
          {pkg.caveats && (
            <ul className="mt-3 space-y-1.5">
              {pkg.caveats.map((c, i) => (
                <li key={i} className="flex gap-2 text-[0.9375rem] text-body">
                  <span
                    className={cn(
                      "mt-1.5 size-1 shrink-0 rounded-full bg-mute"
                    )}
                  />
                  {c}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  )
}
