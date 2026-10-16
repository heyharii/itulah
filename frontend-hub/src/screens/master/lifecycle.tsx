import { usageLabel } from "@/screens/master/term-form"
import { useMutation, type UseQueryResult } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { SubHead } from "@/components/ui/rows"
import { Banner } from "@/components/ui/states"
import { count } from "@/lib/format"
import type { TermUsage } from "@/lib/queries/vocabulary"

/// What may be done to a master value, and the honest reason for it.
///
/// One component for all four lists — divisions, tags, colours, sizes — because
/// the lifecycle is one lifecycle and writing it twice is how two screens come
/// to disagree about when a thing may be destroyed.
///
/// # The rule
///
/// ```text
/// ACTIVE ──retire──▶ RETIRED ──restore──▶ ACTIVE
///
/// ACTIVE + never used ──delete──▶ gone
/// ```
///
/// This is the sheet's "Used by" tab: what points at the value, and Delete. The
/// Active / Inactive switch is not here — it is in the sheet's head, under the
/// name (owner, 2026-10-05), because it is the one decision the sheet is opened
/// for and it should show on every tab.
///
/// **Retire is the ordinary way out**, and it means one thing only: this value
/// may not be chosen for anything NEW. It does not touch what already holds it.
/// The eighty-six articles tagged Denim keep the tag, the promotion that
/// selects on Denim keeps running, and last year's report still groups by it.
/// Retiring is a decision about the future, not an edit to the past — which is
/// why nothing here offers to "clean up" the references, and why the reference
/// list below is shown at the moment of retiring rather than hidden: the point
/// is to say what will *keep* working.
///
/// **Delete is for the typo**, and for nothing else. A value that has ever had
/// business meaning does not leave: a division nothing is filed under today
/// still names twelve thousand transactions in last year's report, and a size
/// code is two characters of every SKU minted in it. So the button appears only
/// when the server says nothing has ever named this value — not when it happens
/// to be unreferenced today. See `TermUsage`, and `0167` for the mark that makes
/// the difference knowable.
///
/// It is absent rather than disabled when the answer is no. A greyed-out Delete
/// invites somebody to hunt for the state that would enable it, and there is no
/// such state: the value has been used, and that is permanent.
export function MasterLifecycle({
  subject,
  usage,
  onDelete,
  onDeleted,
}: {
  /// Singular and lower case: "tag", "colour", "division", "size".
  subject: string
  usage: UseQueryResult<TermUsage>
  onDelete: () => Promise<unknown>
  onDeleted: () => void
}) {
  // Two clicks, and the second one is a different button in the same place.
  // Retiring is reversible and gets one click; this is not, and a sheet is not
  // a place anybody expects a permanent act to happen on the first press.
  const [confirming, setConfirming] = useState(false)

  const remove = useMutation({
    mutationFn: () => onDelete(),
    onSuccess: onDeleted,
  })

  const deletable = usage.data?.can_delete === true
  const blockedAtZero = !!usage.data?.blocked && usage.data.total === 0

  return (
    <div className="flex flex-col gap-5">
      <div>
        <SubHead>Used by</SubHead>
        {usage.isPending ? (
          <p className="text-meta text-mute">Counting…</p>
        ) : usage.isError ? (
          <p className="text-meta text-mute">
            Could not count what points at this {subject}, so nothing may be
            removed from here until it can.
          </p>
        ) : (
          <dl className="flex flex-col gap-1">
            {(usage.data?.references ?? []).map((one) => (
              <div
                key={one.key}
                className="flex items-baseline justify-between gap-4"
              >
                <dt
                  className={
                    one.count > 0
                      ? "text-meta text-text"
                      : "text-meta text-mute"
                  }
                >
                  {usageLabel(one)}
                </dt>
                <dd
                  className={
                    one.count > 0
                      ? "text-[0.9375rem] font-medium text-ink tabular-nums"
                      : "text-[0.9375rem] text-mute tabular-nums"
                  }
                >
                  {count(one.count)}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      {(deletable || remove.isError || blockedAtZero) && (
        <div>
          {remove.isError && (
            <Banner tone="bad" className="mb-2.5">
              {said(remove.error)}
            </Banner>
          )}

          <div className="flex flex-wrap items-center gap-2.5">
            {deletable &&
              (confirming ? (
                <>
                  <Button
                    variant="danger"
                    pending={remove.isPending}
                    onClick={() => remove.mutate()}
                  >
                    {remove.isPending ? "Deleting…" : "Delete Permanently"}
                  </Button>
                  <Button data-cancel variant="quiet" onClick={() => setConfirming(false)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button variant="quiet" onClick={() => setConfirming(true)}>
                  Delete
                </Button>
              ))}
          </div>

          {/* The one case worth explaining, because it is the case somebody
              argues with: nothing points at this today, and it still cannot be
              deleted. The server's own sentence says which of the two reasons
              applies. */}
          {blockedAtZero && (
            <p className="text-meta text-mute">{usage.data?.blocked}</p>
          )}
        </div>
      )}
    </div>
  )
}

/// The server's own sentence about why a write was refused. It names the
/// articles, the promotions or the history that stopped it, and "could not
/// save" would throw all of that away.
function said(error: unknown): string {
  return error instanceof Error ? error.message : "That did not save."
}
