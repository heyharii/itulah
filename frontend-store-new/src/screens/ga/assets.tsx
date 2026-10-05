import { Boxes, TriangleAlert } from "lucide-react"
import { useMemo, useState } from "react"

import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Pill } from "@/components/ui/pill"
import { RecordSheet } from "@/components/ui/record-sheet"
import { Banner } from "@/components/ui/states"
import { count, label } from "@/lib/format"
import { useGaAsset, useGaAssets } from "@/lib/queries/ga"
import {
  ASSET_CLASSES,
  assetStatusOf,
  classOf,
  conditionOf,
  day,
  daysUntil,
  inDays,
} from "@/screens/ga/format"
import {
  ChipRow,
  Fact,
  Facts,
  GaScreen,
  RowTable,
  SearchBox,
  SheetBlock,
  Toolbar,
  TwoLine,
  type RowColumn,
} from "@/screens/ga/parts"
import { RepairComposer } from "@/screens/ga/repair-composer"
import { gaState } from "@/screens/ga/state"
import type { GaAssetEvent, GaAssetRow, GaDocument } from "@itulah/contract"

/// What head office has on its register for THIS shop.
///
/// # Read-only, and that is the owner's decision
///
/// A shop can see what it is holding and cannot add to it. The register is
/// head office's record of what the company owns; when an air conditioner
/// arrives here, somebody at head office registers it, and this screen is how
/// the shop checks that they did. What a shop CAN do is say something is
/// wrong with one — "Report a problem" files a repair request or a note on
/// the thing itself.
///
/// # No rupiah on this screen, ever
///
/// GA's side of the register (`/ga/assets`) carries no money at all — the
/// cost lives in Finance's half, which this never asks for. The asset's own
/// record does carry a "related cost" total; it is not drawn. A shop manager
/// can read the whole list without being shown what the company carries the
/// shop's fit-out at.
///
/// # The things, not the costs
///
/// Work in progress, deferred pre-opening and software are on the register
/// too, but they are costs being paid for rather than objects anybody can walk
/// up to; they are Finance's queue and are left out, as are things already
/// disposed of or replaced. What is left is the number the shop can check
/// against its floor. See `PHYSICAL_BUILDS` and `FLOOR_STATUSES`.
///
/// # Classes, as the hub finds things
///
/// The chips are the hub's seven build views — Property, Technical equipment,
/// Vehicles, Furniture & fixtures, IT hardware, Audio / music, Operating
/// equipment — counted over this shop's own rows. (The server's facets count
/// the whole estate, so they are not used.)
export function Assets() {
  return (
    <GaScreen>
      {(site) => <Register site={site} />}
    </GaScreen>
  )
}

type ClassFilter = "all" | (typeof ASSET_CLASSES)[number]["value"]

const columns: readonly RowColumn<GaAssetRow>[] = [
  {
    id: "asset",
    header: "Asset",
    className: "max-w-[20rem]",
    cell: (row) => (
      <TwoLine
        icon={classOf(row.build).icon}
        top={row.name}
        under={
          <span className="font-mono">
            {row.asset_number}
            {row.serial_number !== null && ` · ${row.serial_number}`}
          </span>
        }
      />
    ),
  },
  {
    id: "class",
    header: "Class",
    cell: (row) => (
      <TwoLine top={row.class_name} under={classOf(row.build).label} />
    ),
  },
  {
    id: "where",
    header: "Where in the shop",
    cell: (row) => row.sub_location ?? <span className="text-faint">—</span>,
  },
  {
    id: "holder",
    header: "Held by",
    card: "hide",
    cell: (row) => row.holder ?? <span className="text-faint">—</span>,
  },
  {
    id: "condition",
    header: "Condition",
    card: "status",
    cell: (row) => {
      const condition = conditionOf(row.condition)
      const status = assetStatusOf(row.status)
      return (
        <span className="inline-flex items-center gap-1.5">
          {status !== null && <Pill tone={status.tone}>{status.label}</Pill>}
          {condition.tone === "ok" ? (
            <span className="text-meta text-body max-md:hidden">
              {condition.label}
            </span>
          ) : (
            <Pill tone={condition.tone}>{condition.label}</Pill>
          )}
        </span>
      )
    },
  },
]

function Register({ site }: { site: string }) {
  const register = useGaAssets(site)
  const [klass, setKlass] = useState<ClassFilter>("all")
  const [typed, setTyped] = useState("")
  // The record and whether its sheet is showing are two facts: the record
  // stays set while the sheet slides away, so it leaves with its content
  // rather than as an empty panel.
  const [openId, setOpenId] = useState<string | null>(null)
  const [showing, setShowing] = useState(false)
  const [reporting, setReporting] = useState<GaAssetRow | null>(null)
  const [composing, setComposing] = useState(false)
  const [filed, setFiled] = useState<"repair" | "note" | null>(null)
  const needle = typed.trim().toLowerCase()

  const rows = useMemo(() => register.data?.rows ?? [], [register.data])
  const shown = useMemo(() => {
    const builds =
      klass === "all"
        ? null
        : (ASSET_CLASSES.find((one) => one.value === klass)?.builds ?? [])
    return rows.filter(
      (row) =>
        (builds === null || builds.includes(row.build)) &&
        (needle === "" ||
          [
            row.name,
            row.asset_number,
            row.serial_number,
            row.class_name,
            row.sub_location,
            row.holder,
          ].some((field) => field?.toLowerCase().includes(needle))),
    )
  }, [rows, klass, needle])
  const open = rows.find((row) => row.asset_id === openId) ?? null

  return (
    <>
      {filed !== null && (
        <Banner
          tone="ok"
          className="mb-4"
          action={
            filed === "repair" ? (
              <AppLink
                to="/ga/repairs"
                className="shrink-0 font-medium underline underline-offset-2"
              >
                See repairs
              </AppLink>
            ) : undefined
          }
        >
          {filed === "repair"
            ? "Sent to head office."
            : "Noted."}
        </Banner>
      )}

      {gaState(register, {
        loading: "Loading…",
        render: () => {
          if (rows.length === 0) {
            return (
              <Card>
                <div className="mx-auto max-w-[30em] px-4 py-12 text-center">
                  <Boxes className="mx-auto mb-3 size-6 text-line-ico" />
                  <p className="text-meta text-body">
                    No assets registered.
                  </p>
                </div>
              </Card>
            )
          }
          const drafts = rows.filter((row) => row.status === "DRAFT").length
          const broken = rows.filter((row) => row.condition !== "BAIK").length
          return (
            <>
              <Toolbar>
                <ChipRow<ClassFilter>
                  label="Class"
                  value={klass}
                  onChange={setKlass}
                  options={[
                    { value: "all", label: "All", count: rows.length },
                    ...ASSET_CLASSES.map((one) => ({
                      value: one.value,
                      label: one.label,
                      icon: one.icon,
                      count: rows.filter((row) =>
                        one.builds.includes(row.build),
                      ).length,
                    })).filter((one) => one.count > 0),
                  ]}
                />
                <SearchBox
                  value={typed}
                  onChange={setTyped}
                  placeholder="Name, number or serial"
                />
              </Toolbar>

              <p className="mb-3 text-meta text-body">
                <b className="font-medium text-ink tabular-nums">
                  {count(shown.length)}
                </b>{" "}
                {shown.length === 1 ? "thing" : "things"}
                {klass !== "all" &&
                  ` · ${ASSET_CLASSES.find((one) => one.value === klass)?.note ?? ""}`}
                {klass === "all" && broken > 0 && (
                  <>
                    {" · "}
                    <span className="text-warn-fg tabular-nums">
                      {count(broken)} need attention
                    </span>
                  </>
                )}
                {klass === "all" && drafts > 0 && (
                  <>
                    {" · "}
                    <span className="tabular-nums">
                      {count(drafts)} not confirmed
                    </span>
                  </>
                )}
              </p>

              <Card>
                <RowTable
                  rows={shown}
                  columns={columns}
                  rowKey={(row) => row.asset_id}
                  onOpen={(row) => {
                    setOpenId(row.asset_id)
                    setShowing(true)
                  }}
                  empty={
                    needle !== ""
                      ? `No match for “${typed.trim()}”.`
                      : "None in this class."
                  }
                />
              </Card>
            </>
          )
        },
      })}

      <AssetSheet
        asset={open}
        open={showing}
        onClose={() => setShowing(false)}
        onReport={(asset) => {
          // One sheet at a time: the record steps aside for the form rather
          // than a dialog stacking on a dialog.
          setShowing(false)
          setFiled(null)
          setReporting(asset)
          setComposing(true)
        }}
      />

      {/* Keyed by the asset so a report on another thing starts clean rather
          than carrying the first one's half-typed words across. */}
      {reporting !== null && (
        <RepairComposer
          key={reporting.asset_id}
          open={composing}
          onClose={() => setComposing(false)}
          site={site}
          asset={reporting}
          onFiled={setFiled}
        />
      )}
    </>
  )
}

/// One thing: what it is, where it stands, the papers with a date on them,
/// and what has happened to it. The row the list already has is drawn at
/// once; the history and papers arrive from `/ga/assets/{id}` behind it.
function AssetSheet({
  asset,
  open,
  onClose,
  onReport,
}: {
  asset: GaAssetRow | null
  open: boolean
  onClose: () => void
  onReport: (asset: GaAssetRow) => void
}) {
  const hub = useGaAsset(asset?.asset_id ?? null)
  if (asset === null) return null
  const condition = conditionOf(asset.condition)
  const status = assetStatusOf(asset.status)
  const specs = Object.entries(asset.specs ?? {}).filter(
    ([, value]) =>
      (typeof value === "string" && value.trim() !== "") ||
      typeof value === "number",
  )

  return (
    <RecordSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      id={asset.asset_number}
      title={asset.name}
      badge={<Pill tone={condition.tone}>{condition.label}</Pill>}
      caption={`${classOf(asset.build).label} · ${asset.class_name}`}
      footer={
        <Button variant="primary" block onClick={() => onReport(asset)}>
          <TriangleAlert />
          Report a problem
        </Button>
      }
    >
      {status !== null && (
        <Banner
          tone={status.tone === "warn" ? "warn" : "info"}
          className="mb-5"
        >
          {asset.status === "DRAFT"
            ? "Not confirmed yet. Tell head office if it isn't here."
            : "Disposal requested by head office."}
        </Banner>
      )}

      <Facts>
        <Fact term="Where in the shop">{asset.sub_location ?? "—"}</Fact>
        <Fact term="Held by">{asset.holder ?? "—"}</Fact>
        <Fact term="Serial / plate">
          <span className="font-mono">{asset.serial_number ?? "—"}</span>
        </Fact>
        <Fact term="Acquired">{day(asset.acquired_on)}</Fact>
        {specs.map(([key, value]) => (
          <Fact key={key} term={label(key)}>
            {String(value)}
          </Fact>
        ))}
      </Facts>

      {gaState(hub, {
        loading: "Loading…",
        render: (answer) => (
          <>
            {answer.documents.length > 0 && (
              <SheetBlock title="Papers" aside="STNK, BPKB, SLO, warranty">
                <ul className="flex flex-col">
                  {answer.documents.map((doc) => (
                    <DocumentLine key={doc.document_id} doc={doc} />
                  ))}
                </ul>
              </SheetBlock>
            )}
            <SheetBlock title="History">
              {answer.events.length === 0 ? (
                <p className="text-meta text-mute">Nothing recorded yet.</p>
              ) : (
                <ol className="flex flex-col">
                  {[...answer.events]
                    .sort((a, b) => b.occurred_on.localeCompare(a.occurred_on))
                    .map((event) => (
                      <EventLine key={event.event_id} event={event} />
                    ))}
                </ol>
              )}
            </SheetBlock>
          </>
        ),
      })}
    </RecordSheet>
  )
}

/// A paper with a date on it. One that runs out inside ninety days is
/// flagged — the threshold the hub's own overview uses for documents.
function DocumentLine({ doc }: { doc: GaDocument }) {
  const left = doc.expires_on === null ? null : daysUntil(doc.expires_on)
  return (
    <li className="flex items-center justify-between gap-3 border-b border-hairline py-2.5 last:border-b-0">
      <span className="min-w-0">
        <span className="block truncate text-cell font-medium text-ink">
          {doc.doc_type ?? doc.title ?? doc.name}
        </span>
        <span className="block truncate text-meta text-mute">
          {[doc.doc_number, doc.issuer].filter(Boolean).join(" · ") || doc.name}
        </span>
      </span>
      {left === null ? (
        <span className="text-meta text-mute">No expiry</span>
      ) : left < 0 ? (
        <Pill tone="bad">Expired {inDays(left)}</Pill>
      ) : left <= 90 ? (
        <Pill tone="warn">Expires {inDays(left)}</Pill>
      ) : (
        <span className="text-meta text-body tabular-nums">
          Until {day(doc.expires_on)}
        </span>
      )}
    </li>
  )
}

function EventLine({ event }: { event: GaAssetEvent }) {
  const what =
    event.kind === "TRANSFER"
      ? `Moved${event.from_site !== null ? ` from ${event.from_site}` : ""}${event.to_site !== null ? ` to ${event.to_site}` : ""}`
      : event.kind === "ASSIGN"
        ? `Handed ${event.to_holder !== null ? `to ${event.to_holder}` : "back"}`
        : event.kind === "CONDITION"
          ? "Condition changed"
          : event.kind === "REGISTERED"
            ? "Registered"
            : "Note"
  return (
    <li className="border-b border-hairline py-2.5 last:border-b-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-cell font-medium text-ink">{what}</span>
        <span className="shrink-0 text-meta text-mute tabular-nums">
          {day(event.occurred_on)}
        </span>
      </div>
      {event.reason.trim() !== "" && (
        <p className="mt-0.5 text-meta text-body">{event.reason}</p>
      )}
      <p className="mt-0.5 text-meta text-mute">{event.recorded_by}</p>
    </li>
  )
}
