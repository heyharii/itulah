import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { useState } from "react"

import { ConfirmButton } from "@/components/ui/dialog"
import { Day } from "@/components/ui/day"
import { Field } from "@/components/ui/field"
import { FindMany, type Found } from "@/components/ui/find"
import {
  MiniCell,
  MiniRow,
  MiniTable,
  SheetSection,
} from "@/components/ui/rows"
import { Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { SheetEmpty } from "@/components/ui/sheet-states"
import { today } from "@/lib/calendar"
import { buildOf } from "@/lib/builds"
import { day } from "@/lib/format"
import { gaAssets, gaKeys } from "@/lib/queries/ga"
import {
  addContractCover,
  gaRecordKeys,
  removeContractCover,
  type GaContractCover,
} from "@/lib/queries/ga-records"
import { toast } from "@/lib/toast"
import {
  NameCell,
  SectionAside,
  TextAction,
} from "@/screens/assets/asset-sections"
import { left } from "@/screens/assets/asset-words"
import { coversVehiclesOnly, fitsCover } from "@/screens/contracts/claim-words"
import type { GaContractRow } from "@itulah/contract"

/// The assets a contract covers (0975): every van on a fleet policy, every AC
/// a maintenance contract services. One row per asset on the roster today; an
/// asset taken off keeps its stay in the history, closed on a day, so a claim
/// about last March still finds the van was covered then.
export function ContractCoversSection({
  contract,
  covers,
}: {
  contract: GaContractRow
  covers: readonly GaContractCover[]
}) {
  const client = useQueryClient()
  const [adding, setAdding] = useState(0)
  const current = covers.filter((one) => one.covered_until === null)
  const living = !contract.archived && contract.status !== "TERMINATED"

  const remove = useMutation({
    mutationFn: (assetId: string) =>
      removeContractCover(contract.contract_id, assetId),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: gaKeys.all })
      void client.invalidateQueries({ queryKey: gaRecordKeys.all })
      toast.success("Taken off the roster")
    },
  })

  return (
    <SheetSection
      title="Covers"
      aside={
        <SectionAside total={current.length}>
          {living && (
            <TextAction
              aria-label="Add asset"
              onClick={() => setAdding((round) => round + 1)}
            >
              <Plus />
              Add asset
            </TextAction>
          )}
        </SectionAside>
      }
    >
      {current.length === 0 ? (
        <SheetEmpty>No asset on the roster yet.</SheetEmpty>
      ) : (
        <MiniTable head={["Asset", left("Site"), left("Since"), left("")]}>
          {current.map((cover) => (
            <MiniRow key={cover.cover_id}>
              <MiniCell>
                <NameCell
                  icon={buildOf(cover.build).icon}
                  name={cover.asset_name}
                  quiet={cover.asset_number}
                />
              </MiniCell>
              <MiniCell>{cover.site_name ?? cover.site_id}</MiniCell>
              <MiniCell>{day(cover.covered_from)}</MiniCell>
              <MiniCell>
                {living && (
                  <ConfirmButton
                    label="Remove"
                    title={`Take ${cover.asset_name} off the roster?`}
                    description="It stays in the contract's history as covered until today."
                    confirmLabel="Take off"
                    cancelLabel="Keep it"
                    tone="danger"
                    variant="ghost"
                    size="sm"
                    onConfirm={() => remove.mutateAsync(cover.asset_id)}
                  />
                )}
              </MiniCell>
            </MiniRow>
          ))}
        </MiniTable>
      )}

      <AddCoverSheet
        key={`add-cover:${adding}`}
        contract={contract}
        held={current.map((one) => one.asset_id)}
        open={adding > 0}
        onClose={() => setAdding(0)}
      />
    </SheetSection>
  )
}

/// Put one more asset on the roster, from a day.
function AddCoverSheet({
  contract,
  held,
  open,
  onClose,
}: {
  contract: GaContractRow
  /// Already on the roster, and not offered again.
  held: readonly string[]
  open: boolean
  onClose: () => void
}) {
  const client = useQueryClient()
  const [asset, setAsset] = useState<readonly Found[]>([])
  const from = today() < contract.starts_on ? contract.starts_on : today()
  const [coveredFrom, setCoveredFrom] = useState(from)
  const [problem, setProblem] = useState("")
  const vehicles = coversVehiclesOnly(contract.contract_type)

  const save = useMutation({
    mutationFn: () =>
      addContractCover(contract.contract_id, {
        asset_id: asset[0]?.value ?? "",
        covered_from: coveredFrom,
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: gaKeys.all })
      void client.invalidateQueries({ queryKey: gaRecordKeys.all })
      toast.success("Added to the roster")
      onClose()
    },
  })

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      size="rail"
      context="Contract"
      id={contract.contract_number ?? undefined}
      title="Add asset"
      caption={contract.contract_type_name}
      dirty={asset.length > 0 && !save.isSuccess}
      footer={
        <SheetFooter
          error={save.error}
          onCancel={onClose}
          primary={{
            label: "Add asset",
            pendingLabel: "Adding…",
            pending: save.isPending,
            onClick: () => {
              if (asset.length === 0) {
                setProblem(
                  vehicles ? "Choose the vehicle." : "Choose the asset."
                )
                return
              }
              save.mutate()
            },
          }}
        />
      }
    >
      <div className="grid gap-6">
        <Field
          label={vehicles ? "Vehicle" : "Asset"}
          required
          problem={problem || undefined}
        >
          <FindMany
            chosen={asset}
            // One asset: a second pick replaces the first.
            onChange={(next) => {
              setAsset(next.slice(-1))
              setProblem("")
            }}
            queryKey={(needle) => [
              "ga",
              "cover-find",
              contract.contract_id,
              needle,
            ]}
            search={async (needle, signal) => {
              const page = await gaAssets(
                {
                  q: needle,
                  limit: 20,
                  build: vehicles ? "VEHICLE" : undefined,
                  site: contract.site_id ?? undefined,
                },
                signal
              )
              return page.rows
                .filter(
                  (row) =>
                    !held.includes(row.asset_id) &&
                    fitsCover(contract.contract_type, row)
                )
                .map((row) => ({
                  value: row.asset_id,
                  label: row.name,
                  note: `${row.asset_number} · ${row.class_name}`,
                }))
            }}
            label={vehicles ? "The vehicle it covers" : "The asset it covers"}
            offline="The asset register is not answering."
          />
        </Field>
        <Field label="Covered from" required>
          <Day
            value={coveredFrom}
            onChange={setCoveredFrom}
            notBefore={contract.starts_on}
            notAfter={contract.ends_on}
            clearable={false}
            required
            label="Covered from"
          />
        </Field>
      </div>
    </Sheet>
  )
}
