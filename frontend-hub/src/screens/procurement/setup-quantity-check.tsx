import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { Problem } from "@/components/ui/states"
import { ago, count } from "@/lib/format"
import {
  askQuantityCheck,
  listLineQuantityChecks,
  quantityCheckKeys,
} from "@/lib/queries/quantity-checks"

/// The warehouse's count of this delivery by colour and size, as a reference
/// while the article is named (owner, 2026-10-06). Nothing waits for it and
/// nothing is checked against it: the newest answer is shown as a flat list, and
/// "Recount" asks the warehouse again, which issues a new check.
export function QuantityCheckPanel({
  receiptLineId,
  name,
}: {
  receiptLineId: string
  /// The name as it stands in the form, kept with the ask so the warehouse
  /// can say which goods it is counting.
  name: string
}) {
  const client = useQueryClient()
  const checks = useQuery({
    queryKey: quantityCheckKeys.line(receiptLineId),
    queryFn: ({ signal }) => listLineQuantityChecks(receiptLineId, signal),
    refetchInterval: 15_000,
  })
  const ask = useMutation({
    mutationFn: () =>
      askQuantityCheck({
        receipt_line_id: receiptLineId,
        article_name: name.trim() === "" ? "Delivery" : name.trim(),
      }),
    onSuccess: () =>
      client.invalidateQueries({
        queryKey: quantityCheckKeys.line(receiptLineId),
      }),
  })

  const all = checks.data ?? []
  const counted = all.find((one) => one.status === "COUNTED") ?? null
  const asked = all.some((one) => one.status === "REQUESTED")

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-[0.9375rem] font-medium text-ink">
          Quantity Check
        </h4>
        <Button
          variant="ghost"
          disabled={asked}
          pending={ask.isPending}
          onClick={() => ask.mutate()}
        >
          {asked
            ? "Requested"
            : counted !== null
              ? "Recount"
              : "Request Quantity Check"}
        </Button>
      </div>
      <Problem error={ask.error} />
      {counted !== null && (
        <div className="overflow-hidden rounded-inner border border-hairline">
          {counted.lines.map((line, at) => (
            <div
              key={`${line.colour}|${line.size}|${at}`}
              className="flex items-center justify-between gap-3 px-3.5 py-2 text-[0.9375rem] not-first:border-t not-first:border-hairline"
            >
              <span className="min-w-0 truncate text-ink">
                {line.colour} · {line.size}
              </span>
              <span className="shrink-0 text-ink tabular-nums">
                {count(line.quantity)}
              </span>
            </div>
          ))}
          <div className="border-t border-hairline bg-soft-2 px-3.5 py-2 text-[0.875rem] text-mute">
            Counted by {counted.counted_by}
            {counted.counted_at !== null && ` · ${ago(counted.counted_at)}`}
          </div>
        </div>
      )}
    </div>
  )
}
