import { Link2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input, Select } from "@/components/ui/field"
import { count } from "@/lib/format"
import { useAssetClasses, useLocations } from "@/screens/finance/hooks"
import {
  PARTY_GROUPS,
  useDimensions,
  useExpenseCategories,
  useOpenAccountLinks,
  usePayComponents,
  usePaymentMethods,
  useTaxTemplates,
} from "@/screens/finance/master-data"

/// The pieces every Finance master screen is drawn with: the "Link accounts"
/// action, the reach cell, the source picker Account Links uses, and the
/// list-beside-form layout.

/// The quick action on every master row.
export function LinkAccountsButton({
  role,
  sourceType,
  sourceId,
  label = "Link accounts",
}: {
  role?: string | null
  sourceType: string
  sourceId: string
  label?: string
}) {
  const open = useOpenAccountLinks()
  return (
    <Button
      size="sm"
      variant="quiet"
      onClick={(event) => {
        // A master row usually opens its own editor on click; this must not.
        event.stopPropagation()
        open({ role, source_type: sourceType, source_id: sourceId })
      }}
    >
      <Link2 />
      {label}
    </Button>
  )
}

/// How many units a master record reaches an account in, against how many
/// there are. Fewer is a posting refused somewhere, by name.
export function Reach({ units }: { units: number }) {
  const locations = useLocations()
  const total = locations.data?.locations.length ?? null
  if (units === 0)
    return <span className="font-medium text-bad-fg">Not linked</span>
  if (total !== null && units < total)
    return (
      <span className="font-medium text-warn-fg tabular-nums">
        {count(units)} of {count(total)} units
      </span>
    )
  return (
    <span className="text-ok-fg tabular-nums">
      {total === null ? `${count(units)} units` : "Every unit"}
    </span>
  )
}

/// A yes/no cell: the yes said, the no quiet.
export function YesNo({ on, yes = "Yes" }: { on: boolean; yes?: string }) {
  return on ? (
    <span className="text-ink">{yes}</span>
  ) : (
    <span className="text-faint">—</span>
  )
}
// ---------------------------------------------------------------------------
// Choosing a source record
// ---------------------------------------------------------------------------

interface SourceOption {
  readonly value: string
  readonly label: string
}

/// The records a source type can name, as options. Only the list the type
/// needs is fetched.
function useSourceOptions(sourceType: string): {
  options: readonly SourceOption[] | null
  loading: boolean
} {
  const categories = useExpenseCategories(sourceType === "EXPENSE_CATEGORY")
  const components = usePayComponents(sourceType === "PAY_COMPONENT")
  const methods = usePaymentMethods(sourceType === "PAYMENT_METHOD")
  const templates = useTaxTemplates(sourceType === "TAX_TEMPLATE")
  const dimensions = useDimensions(sourceType === "DIVISION")
  const classes = useAssetClasses()

  switch (sourceType) {
    case "EXPENSE_CATEGORY":
      return {
        loading: categories.isPending,
        options: (categories.data ?? []).map((row) => ({
          value: row.code,
          label: `${row.code} — ${row.name}${row.is_active ? "" : " (inactive)"}`,
        })),
      }
    case "PAY_COMPONENT":
      return {
        loading: components.isPending,
        options: (components.data ?? []).map((row) => ({
          value: row.code,
          label: `${row.code} — ${row.label}${row.retired ? " (retired)" : ""}`,
        })),
      }
    case "PAYMENT_METHOD":
      return {
        loading: methods.isPending,
        options: (methods.data ?? []).map((row) => ({
          value: row.code,
          label: `${row.code} — ${row.name}`,
        })),
      }
    case "TAX_TEMPLATE":
      return {
        loading: templates.isPending,
        options: (templates.data ?? []).map((row) => ({
          value: row.code,
          label: `${row.code} — ${row.name}`,
        })),
      }
    case "DIVISION":
      return {
        loading: dimensions.isPending,
        options: (
          (dimensions.data ?? []).find((one) => one.code === "DIVISION")
            ?.values ?? []
        ).map((row) => ({
          value: row.value_code,
          label: `${row.value_code} — ${row.name}`,
        })),
      }
    case "ASSET_CLASS":
      return {
        loading: classes.isPending,
        options: classes.rows.map((row) => ({
          value: row.class_code,
          label: `${row.class_code} — ${row.name}`,
        })),
      }
    default:
      return { options: null, loading: false }
  }
}

/// Which record a link is for. A list where the source type has one; typed
/// text for the company's own qualifier (a bank, a class) and for a party,
/// which is named `TYPE:id`. A party group is one of three supplier kinds.
export function SourceIdPicker({
  sourceType,
  value,
  onChange,
  suggestions = [],
}: {
  sourceType: string
  value: string
  onChange: (next: string) => void
  /// Qualifiers already in use, offered as the text is typed.
  suggestions?: readonly string[]
}) {
  const { options, loading } = useSourceOptions(sourceType)

  if (sourceType === "PARTY_GROUP") {
    return (
      <Select value={value} onChange={onChange} aria-label="Party group">
        <option value="">Choose one</option>
        {PARTY_GROUPS.map((one) => (
          <option key={one.value} value={one.value}>
            {one.label}
          </option>
        ))}
      </Select>
    )
  }

  if (options !== null) {
    const unknown = value !== "" && !options.some((one) => one.value === value)
    return (
      <Select value={value} onChange={onChange} aria-label="Source record">
        <option value="">{loading ? "Loading…" : "Choose one"}</option>
        {options.map((one) => (
          <option key={one.value} value={one.value}>
            {one.label}
          </option>
        ))}
        {unknown && <option value={value}>{value}</option>}
      </Select>
    )
  }

  const listId = `link-source-${sourceType.toLowerCase()}`
  return (
    <>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={sourceType === "PARTY" ? "SUPPLIER:SUP-0012" : ""}
        list={listId}
      />
      <datalist id={listId}>
        {suggestions
          .filter((one) => one !== "")
          .map((one) => (
            <option key={one} value={one} />
          ))}
      </datalist>
    </>
  )
}
// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/// The list, and beside it the one record being added or changed.
export function MasterLayout({
  list,
  editor,
}: {
  list: React.ReactNode
  editor: React.ReactNode
}) {
  return (
    <div
      className={
        editor
          ? "grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]"
          : "grid gap-4"
      }
    >
      <div className="min-w-0">{list}</div>
      {editor}
    </div>
  )
}

export function EditorCard({
  title,
  onClose,
  children,
}: {
  title: React.ReactNode
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-card-title font-semibold text-ink">{title}</h3>
        <Button size="sm" variant="quiet" onClick={onClose}>
          Close
        </Button>
      </div>
      {children}
    </Card>
  )
}
