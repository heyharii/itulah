import type { GaInsuranceClaimRow } from "@/lib/queries/ga-records"
import type { GaContractRow } from "@itulah/contract"

/// The words an insurance claim is read in (0975), kept out of the component
/// files because those export components only.

/// The two policy types a claim is made under (`CLAIM_POLICY_TYPES` in
/// `ga_claims.rs`).
export const CLAIM_POLICY_TYPES: readonly string[] = [
  "ASURANSI_KENDARAAN",
  "ASURANSI_PROPERTI",
]

/// Whether a contract is a policy a claim can be made under: insurance, and
/// activated (the server refuses a claim under a draft).
export function isClaimablePolicy(contract: GaContractRow): boolean {
  return (
    CLAIM_POLICY_TYPES.includes(contract.contract_type) &&
    contract.status !== "DRAFT" &&
    !contract.archived
  )
}

/// The claim's one status, as the head and the rows show it.
export function claimStatus(status: string): {
  word: string
  tone: "warn" | "info" | "neutral" | "ok" | "done"
} {
  switch (status) {
    case "DRAFT":
      return { word: "Draft", tone: "warn" }
    case "SUBMITTED":
      return { word: "Submitted", tone: "info" }
    case "SURVEYED":
      return { word: "Surveyed", tone: "neutral" }
    case "APPROVED":
      return { word: "Approved", tone: "neutral" }
    case "PAID":
      return { word: "Paid", tone: "done" }
    case "REJECTED":
      return { word: "Rejected", tone: "done" }
    default:
      return { word: status, tone: "neutral" }
  }
}

/// What the claim waits for now, in one line.
export function claimWaits(status: string): string | null {
  switch (status) {
    case "DRAFT":
      return "Photos and police report to attach, then submit"
    case "SUBMITTED":
      return "Waiting for the insurer's survey"
    case "SURVEYED":
      return "Waiting for the insurer's decision"
    case "APPROVED":
      return "Repair at the workshop, then the insurer's payment"
    default:
      return null
  }
}

/// The amount a row shows: what the insurer approved, else what was claimed.
export function claimAmount(claim: GaInsuranceClaimRow): number | null {
  return claim.approved_minor ?? claim.estimated_loss_minor
}

/// The claim's own reference: the insurer's number once it has one.
export function claimReference(claim: GaInsuranceClaimRow): string | null {
  return claim.insurer_claim_number
}

/// The types whose contract covers THINGS (`contract_type_covers_assets` in
/// `ga_contracts.rs`): the vehicle's insurance and its STNK/KIR, a property
/// policy and a maintenance contract. Every other type covers a place.
const COVER_TYPES: readonly string[] = [
  "ASURANSI_KENDARAAN",
  "IZIN_KENDARAAN",
  "ASURANSI_PROPERTI",
  "JASA_MAINTENANCE",
]

/// Of those, the two that cover vehicles and nothing else.
const VEHICLE_COVER_TYPES: readonly string[] = [
  "ASURANSI_KENDARAAN",
  "IZIN_KENDARAAN",
]

/// The builds a property policy or a maintenance contract cannot cover:
/// nothing physical to insure or service.
const UNCOVERED_BUILDS: readonly string[] = ["SOFTWARE", "DEFERRED", "CIP"]

export function coversAssets(contractType: string): boolean {
  return COVER_TYPES.includes(contractType)
}

export function coversVehiclesOnly(contractType: string): boolean {
  return VEHICLE_COVER_TYPES.includes(contractType)
}

/// Whether an asset can go on a roster of this type, as the server will
/// decide it: not one that left the register, a vehicle for the vehicle
/// types, a physical thing for the others. The place is the server's check.
export function fitsCover(
  contractType: string,
  asset: { status: string; build: string }
): boolean {
  if (asset.status === "DISPOSED" || asset.status === "REPLACED") return false
  if (coversVehiclesOnly(contractType)) return asset.build === "VEHICLE"
  return coversAssets(contractType) && !UNCOVERED_BUILDS.includes(asset.build)
}
