import { queryOptions } from "@tanstack/react-query"

import { node } from "@/lib/api"
import type {
  AdjustBenefitBody,
  BenefitAccountView,
  BenefitBalanceRow,
  BenefitMovementRow,
  BenefitSettingBody,
  BenefitSettingView,
} from "@itulah/contract"

/// The employee benefit: a rupiah balance per employee that HR fills by hand
/// and the employee spends at the till with a short-lived code.

export const benefitKeys = {
  all: () => ["people", "benefit"] as const,
  balances: () => ["people", "benefit", "balances"] as const,
  account: (employeeId: string) =>
    ["people", "benefit", "account", employeeId] as const,
  movements: (from: string, to: string, unitId: string | null) =>
    ["people", "benefit", "movements", from, to, unitId] as const,
  settings: () => ["people", "benefit", "settings"] as const,
}

export function benefitBalances(
  signal?: AbortSignal
): Promise<BenefitBalanceRow[]> {
  return node.get<BenefitBalanceRow[]>("/api/v1/benefit/balances", { signal })
}

/// Every movement of every balance in the caller's reach between two days,
/// newest first. `unitId` is where the person is posted now.
export function benefitMovements(
  from: string,
  to: string,
  unitId: string | null,
  signal?: AbortSignal
): Promise<BenefitMovementRow[]> {
  const query = new URLSearchParams({ from, to })
  if (unitId !== null) query.set("unit", unitId)
  return node.get<BenefitMovementRow[]>(
    `/api/v1/benefit/entries?${query.toString()}`,
    { signal }
  )
}

/// ADD, REMOVE or RESET for one or many people at once. Taking off more than
/// somebody has is a 409 with a sentence.
export function adjustBenefit(
  body: AdjustBenefitBody
): Promise<BenefitBalanceRow[]> {
  return node.post<BenefitBalanceRow[]>("/api/v1/benefit/adjustments", body)
}

export function benefitAccount(
  employeeId: string,
  signal?: AbortSignal
): Promise<BenefitAccountView> {
  return node.get<BenefitAccountView>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}/benefit`,
    { signal }
  )
}

/// Newest first; none at all means the benefit is off.
export function benefitSettings(
  signal?: AbortSignal
): Promise<BenefitSettingView[]> {
  return node.get<BenefitSettingView[]>("/api/v1/benefit/settings", { signal })
}

export function stateBenefitSetting(
  body: BenefitSettingBody
): Promise<BenefitSettingView> {
  return node.post<BenefitSettingView>("/api/v1/benefit/settings", body)
}

export const BENEFIT_KIND_LABEL: Readonly<Record<string, string>> = {
  ADD: "Added",
  REMOVE: "Taken off",
  RESET: "Reset",
  SPEND: "Spent at the till",
  RETURN: "Returned",
}

export type BenefitAction = AdjustBenefitBody["action"]

export const BENEFIT_ACTION_LABEL: Readonly<Record<BenefitAction, string>> = {
  ADD: "Add to balance",
  REMOVE: "Take off",
  RESET: "Reset to",
}

/// `+Rp5.000` / `-Rp5.000`, so a movement reads as a movement.
export function signedMinor(
  delta: number,
  format: (minor: number) => string
): string {
  return `${delta > 0 ? "+" : delta < 0 ? "-" : ""}${format(Math.abs(delta))}`
}

export const benefitSettingsQuery = () =>
  queryOptions({
    queryKey: benefitKeys.settings(),
    queryFn: ({ signal }) => benefitSettings(signal),
  })

export const benefitBalancesQuery = () =>
  queryOptions({
    queryKey: benefitKeys.balances(),
    queryFn: ({ signal }) => benefitBalances(signal),
  })
