import { Screen, Section } from "@/components/ui/screen"
import { words } from "@/lib/format"
import { queryState } from "@/lib/query-state"
import {
  useReturnPolicy,
  type ReturnPolicyRule,
  type ReturnPolicySnapshot,
} from "@/lib/queries/return-policy"

/// Return policy — what head office allows to come back, read-only.
export function ReturnPolicy() {
  const policy = useReturnPolicy()
  return (
    <Screen>
      {queryState(policy, {
        loading: "Reading the return policy…",
        render: (answer) => <Policy snapshot={answer} />,
      })}
    </Screen>
  )
}

const yes = (on: boolean, whenOn: string, whenOff: string) =>
  on ? whenOn : whenOff

function Policy({ snapshot }: { snapshot: ReturnPolicySnapshot }) {
  const { setting, rules } = snapshot
  const exchange = setting.same_item_exchange
    ? [
        "On",
        setting.same_item_same_cost && "same cost",
        setting.same_item_same_supplier && "same supplier",
      ]
        .filter(Boolean)
        .join(" · ")
    : "Off"
  return (
    <>
      <Section>
        <p className="text-[0.9375rem] text-mute">Return within</p>
        <p className="text-2xl font-semibold text-ink">
          {setting.max_days} days
        </p>
      </Section>
      <Section title="Conditions">
        <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
          <Fact
            label="Hang tag"
            value={yes(setting.require_hang_tag, "Must be on", "Not needed")}
          />
          <Fact
            label="Receipt"
            value={yes(setting.require_receipt, "Needed", "Not needed")}
          />
          <Fact label="Same-item exchange" value={exchange} />
          <Fact
            label="Returns per receipt"
            value={yes(
              setting.one_return_per_receipt,
              "One",
              "Each piece once",
            )}
          />
          <Fact
            label="Return receipt"
            value={yes(
              setting.return_receipt_returnable,
              "Can come back",
              "Never comes back",
            )}
          />
        </dl>
      </Section>
      <Section title="Exceptions">
        {rules.length === 0 ? (
          <p className="text-[0.9375rem] text-mute">No exceptions.</p>
        ) : (
          <Exceptions rules={rules} />
        )}
      </Section>
    </>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[0.9375rem] text-mute">{label}</dt>
      <dd className="text-[1.0625rem] font-semibold text-ink">{value}</dd>
    </div>
  )
}

const KIND: Record<ReturnPolicyRule["scope_kind"], string> = {
  GLOBAL: "Every Article",
  DIVISION: "Division",
  TAG: "Tag",
  ARTICLE: "Article",
}

function appliesTo(rule: ReturnPolicyRule): string {
  if (rule.scope_kind === "GLOBAL" || rule.targets.length === 0) {
    return KIND.GLOBAL
  }
  return `${KIND[rule.scope_kind]}: ${rule.targets.map((code) => words(code)).join(", ")}`
}

function Exceptions({ rules }: { rules: readonly ReturnPolicyRule[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-hairline">
      <table className="w-full text-left text-[0.9375rem]">
        <thead className="text-mute">
          <tr className="border-b border-hairline">
            <th className="px-4 py-3 font-medium">Name</th>
            <th className="px-4 py-3 font-medium">Applies To</th>
            <th className="px-4 py-3 font-medium">Return Within</th>
          </tr>
        </thead>
        <tbody>
          {rules.map((rule, index) => (
            <tr
              key={index}
              className="border-b border-hairline last:border-b-0"
            >
              <td className="px-4 py-3 font-semibold text-ink">{rule.name}</td>
              <td className="px-4 py-3 text-ink">{appliesTo(rule)}</td>
              <td className="px-4 py-3 text-ink">
                {rule.exchangeable ? `${rule.max_days} days` : "Never"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
