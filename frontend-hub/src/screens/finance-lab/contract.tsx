import { useMemo, useState } from "react"

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
  Panel,
  ReadinessTag,
  Row,
  Section,
  SimBadge,
  Table,
} from "@/screens/finance-lab/parts"
import type { AccountRole, RulePackage } from "@/screens/finance-lab/engine/types"

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
    <div>
      <PageHeader
        crumb="Finance lab"
        title="Kontrak"
        sub="Aturan posting, peran akun, dan peta ke bagan akun klien. Bukti, kesiapan dan aktivasi dipisah."
        actions={
          <div className="flex items-center gap-2">
            <SimBadge />
            <Segmented
              value={tab}
              onChange={setTab}
              options={[
                { value: "rules", label: `Aturan ${PACKAGES.length}` },
                { value: "roles", label: `Peran ${roles.length}` },
                { value: "map", label: `Peta ${BINDINGS.length}` },
              ]}
            />
          </div>
        }
      />

      {tab === "rules" && (
        <>
          {off.length > 0 && (
            <Section
              title={`${off.length} aturan tidak aktif`}
              sub="Dideklarasikan lengkap, ditampilkan, dan menolak memposting. Alasannya spesifik."
            >
              <div className="space-y-2">
                {off.map((p) => (
                  <Blocked key={p.package_id}>
                    <span className="font-mono text-[0.75rem] font-semibold">
                      {p.package_id}@{p.version}
                    </span>{" "}
                    — {p.title}
                    <div className="mt-1">{p.activation.blocked_reason}</div>
                    <div className="mt-1 text-[0.75rem] opacity-90">{p.evidence.note}</div>
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
          {unbound.length > 0 ? (
            <Section title="Peran tanpa binding">
              <Blocked>
                <span className="font-semibold">
                  {unbound.length} peran yang dipakai aturan tidak punya satu pun binding:
                </span>{" "}
                {unbound.join(", ")}. Aturan yang menyebutnya akan ditolak dan penolakannya menyebut
                nama peran ini. Untuk <span className="font-mono">REPLACEMENT_RESERVE</span> itu
                disengaja — tidak ada tarif reserve yang dikonfirmasi, jadi tidak ada akun yang boleh
                menerimanya.
              </Blocked>
            </Section>
          ) : (
            <Section title="Peran tanpa binding">
              <Panel>
                <p className="px-3.5 py-3 text-[0.8125rem] text-ok-fg">
                  Semua peran yang dipakai aturan punya binding.
                </p>
              </Panel>
            </Section>
          )}

          <Section
            title="Peran dan akun yang menjawabnya"
            sub="Satu peran bisa punya beberapa binding, dipersempit oleh dimensi yang berbeda."
          >
            <Panel>
              <Table head={["Peran", ">Binding", "Contoh akun", "Dipersempit oleh"]}>
                {roles.map((r) => {
                  const bs = BINDINGS.filter((b) => b.role === r)
                  const narrows = new Set<string>()
                  for (const b of bs)
                    for (const k of Object.keys(b.narrows)) if (k !== "unit_id") narrows.add(k)
                  return (
                    <Row key={r} tone={bs.length === 0 ? "bad" : undefined}>
                      <Cell mono>{r}</Cell>
                      <Cell right>{bs.length}</Cell>
                      <Cell>
                        {bs[0] ? (
                          <>
                            <span className="font-mono text-[0.75rem] text-mute">
                              {bs[0].account_code}
                            </span>
                            <div>{account(bs[0].account_code)?.name}</div>
                          </>
                        ) : (
                          <span className="text-bad-fg">tidak ada</span>
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
            </Panel>
          </Section>
        </>
      )}

      {tab === "map" && (
        <>
          <Section
            title="Rekening bank terdaftar"
            sub="Identitas rekening — bukan nama bank — yang menjadi dimensi. Inilah perbaikan ambiguitas BANK_CUSTODY."
          >
            <Panel>
              <Table head={["Identitas", "Bank", "Produk", "Nomor", "Unit"]}>
                {BANK_ACCOUNTS.map((a) => (
                  <Row key={a.bank_account_id}>
                    <Cell mono>{a.bank_account_id}</Cell>
                    <Cell>{a.bank}</Cell>
                    <Cell>
                      <Tag tone={a.product === "GIRO" ? "info" : "neutral"}>{a.product}</Tag>
                    </Cell>
                    <Cell className="text-mute">{a.number_masked}</Cell>
                    <Cell>{a.unit_id}</Cell>
                  </Row>
                ))}
              </Table>
            </Panel>
            <p className="mt-2 text-[0.8125rem] text-body">
              BCA punya giro dan tabungan di unit yang sama. Kalau dimensinya &ldquo;BCA&rdquo;,
              resolver tidak bisa memilih di antara keduanya — dan itu berlaku sama untuk Mandiri,
              BRI dan BNI. Dengan identitas rekening, tidak ada satu pun pasangan yang ambigu.
            </p>
          </Section>

          <Section title="Binding" sub="Setiap baris punya masa berlaku dan versi.">
            <Panel>
              <Table head={["Peran", "Dipersempit", "Akun", "Berlaku dari", "Versi"]}>
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
                      <span className="ml-1 text-mute">{b.narrows.unit_id}</span>
                    </Cell>
                    <Cell>
                      <span className="font-mono text-[0.75rem] text-mute">{b.account_code}</span>
                      <div>{account(b.account_code)?.name ?? <span className="text-bad-fg">tidak ada di bagan</span>}</div>
                    </Cell>
                    <Cell>{b.valid_from}</Cell>
                    <Cell right>{b.version}</Cell>
                  </Row>
                ))}
              </Table>
            </Panel>
          </Section>
        </>
      )}
    </div>
  )
}

function RuleCard({ pkg }: { pkg: RulePackage }) {
  const [open, setOpen] = useState(false)
  return (
    <Panel>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full flex-wrap items-baseline gap-x-2.5 gap-y-1 px-3.5 py-2.5 text-left hover:bg-soft-1"
      >
        <span className="font-mono text-[0.75rem] font-semibold text-ink">
          {pkg.package_id}@{pkg.version}
        </span>
        <span className="text-[0.875rem] text-ink">{pkg.title}</span>
        <span className="ml-auto flex items-center gap-1.5">
          <Tag tone="accent">{pkg.mode}</Tag>
          <EvidenceTag evidence={pkg.evidence} />
          <ReadinessTag readiness={pkg.readiness} />
        </span>
      </button>
      {open && (
        <div className="border-t border-hairline px-3.5 py-3">
          <p className="mb-3 text-[0.8125rem] text-body">
            <span className="font-medium text-ink">Bukti: </span>
            {pkg.evidence.kind === "ACTUAL_JOURNAL" && (
              <span className="font-mono text-[0.75rem]">{pkg.evidence.document} — </span>
            )}
            {pkg.evidence.note}
          </p>
          <Table head={["#", "Sisi", "Peran", "Dipersempit oleh", "Dasar nilai", "Alternatif"]}>
            {pkg.lines.map((l) => (
              <Row key={l.seq}>
                <Cell>{l.seq}</Cell>
                <Cell>
                  <Tag tone={l.side === "DEBIT" ? "info" : "warn"}>{l.side}</Tag>
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
                <li key={i} className="flex gap-2 text-[0.8125rem] text-body">
                  <span className={cn("mt-1.5 size-1 shrink-0 rounded-full bg-mute")} />
                  {c}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Panel>
  )
}
