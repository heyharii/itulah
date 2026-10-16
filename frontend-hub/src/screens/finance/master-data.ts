import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"

import {
  dimensionsQuery,
  expenseCategoriesQuery,
  payComponentsQuery,
  paymentMethodsQuery,
  taxTemplatesQuery,
} from "@/lib/queries/finance"

/// Finance's master data, and the one bridge every master screen shares: the
/// "Link accounts" action that lands on Account links narrowed to the record.
///
/// # Why the accounts are not edited on each master screen
///
/// A category, a pay component, a payment method, a withholding template —
/// each of them decides where money lands, and each decision is an account
/// LINK: a role, a source (the record), a scope and an account. Growing an
/// account picker on every master screen would be eight editors for one kind
/// of decision, each with its own idea of scope. So a master row says how many
/// sites it reaches and offers one door to the screen that edits links.
///
/// The components that draw it are in `master-parts.tsx`; this file holds the
/// words, the URL shape and the queries.

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

/// Where a link's decision is kept. `COMPANY` is the company's own default;
/// the rest are the master records that carry decisions of their own.
export const SOURCE_TYPES = [
  { value: "COMPANY", label: "Company default" },
  { value: "EXPENSE_CATEGORY", label: "Expense category" },
  { value: "PARTY", label: "Party" },
  { value: "PARTY_GROUP", label: "Party group" },
  { value: "PAY_COMPONENT", label: "Pay component" },
  { value: "ASSET_CLASS", label: "Asset class" },
  { value: "PAYMENT_METHOD", label: "Payment method" },
  { value: "TAX_TEMPLATE", label: "Tax template" },
  { value: "DIVISION", label: "Division" },
] as const

/// The supplier groups a `PARTY_GROUP` link may name — the server accepts these
/// three and no other.
export const PARTY_GROUPS = [
  { value: "SUPPLIER:MERCHANDISE", label: "Merchandise suppliers" },
  { value: "SUPPLIER:EXPENSE", label: "Expense suppliers" },
  { value: "SUPPLIER:AFFILIATE", label: "Affiliate suppliers" },
] as const

export function sourceTypeLabel(type: string): string {
  return SOURCE_TYPES.find((one) => one.value === type)?.label ?? type
}

export interface LinkSource {
  readonly source_type: string
  readonly source_id: string
}

/// `TYPE:id`, split at the FIRST colon: a party's id is `SUPPLIER:SUP-0012`.
export function encodeLinkSource(source: LinkSource): string {
  return `${source.source_type}:${source.source_id}`
}

export function decodeLinkSource(
  value: string | null | undefined
): LinkSource | null {
  if (value === null || value === undefined || value === "") return null
  const at = value.indexOf(":")
  if (at <= 0) return { source_type: value.toUpperCase(), source_id: "" }
  return {
    source_type: value.slice(0, at).toUpperCase(),
    source_id: value.slice(at + 1),
  }
}

/// A source as a person reads it: "Expense category · MEDICAL".
export function sourceWords(source: LinkSource): string {
  if (source.source_type === "COMPANY")
    return source.source_id === ""
      ? "Company default"
      : `Company · ${source.source_id}`
  return source.source_id === ""
    ? sourceTypeLabel(source.source_type)
    : `${sourceTypeLabel(source.source_type)} · ${source.source_id}`
}

/// Open Account links on one role (when known) narrowed to one source.
export function useOpenAccountLinks() {
  const navigate = useNavigate()
  return (target: { role?: string | null } & LinkSource) =>
    navigate({
      to: "/finance/setup/account-links",
      search: {
        mapping: target.role ?? undefined,
        // The company's own unqualified default narrows nothing: every role
        // has one.
        linkSource:
          target.source_type === "COMPANY" && target.source_id === ""
            ? undefined
            : encodeLinkSource(target),
      },
    } as never)
}

// ---------------------------------------------------------------------------
// The lists, one key each
// ---------------------------------------------------------------------------

/// For the pickers and panels that read a list only when asked (`enabled`).
/// A screen whose body IS one of these lists reads the options themselves
/// (`lib/queries/finance.ts`) with `useSuspenseQuery`, which is what
/// `prefetch.ts` warms.

export function useExpenseCategories(enabled = true) {
  return useQuery({ ...expenseCategoriesQuery(), enabled })
}

export function usePayComponents(enabled = true) {
  return useQuery({ ...payComponentsQuery(), enabled })
}

export function usePaymentMethods(enabled = true) {
  return useQuery({ ...paymentMethodsQuery(), enabled })
}

export function useTaxTemplates(enabled = true) {
  return useQuery({ ...taxTemplatesQuery(), enabled })
}

export function useDimensions(enabled = true) {
  return useQuery({ ...dimensionsQuery(), enabled })
}
