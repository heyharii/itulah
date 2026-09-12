import { useMutation, type UseQueryResult } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Pill } from "@/components/ui/pill"
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
  label,
  active,
  usage,
  onSetActive,
  onDelete,
  onDeleted,
}: {
  /// Singular and lower case: "tag", "colour", "division", "size".
  subject: string
  label: string
  active: boolean
  usage: UseQueryResult<TermUsage>
  onSetActive: (next: boolean) => Promise<unknown>
  onDelete: () => Promise<unknown>
  onDeleted: () => void
}) {
  // Two clicks, and the second one is a different button in the same place.
  // Retiring is reversible and gets one click; this is not, and a sheet is not
  // a place anybody expects a permanent act to happen on the first press.
  const [confirming, setConfirming] = useState(false)

  const change = useMutation({
    mutationFn: (next: boolean) => onSetActive(next),
  })
  const remove = useMutation({
    mutationFn: () => onDelete(),
    onSuccess: onDeleted,
  })

  const spoken = (usage.data?.references ?? []).filter((one) => one.count > 0)
  const deletable = usage.data?.can_delete === true

  return (
    <div className="mt-6 flex flex-col gap-4 border-t border-hairline pt-4">
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
                  {one.label}
                </dt>
                <dd
                  className={
                    one.count > 0
                      ? "text-[0.8125rem] font-medium text-ink tabular-nums"
                      : "text-[0.8125rem] text-mute tabular-nums"
                  }
                >
                  {count(one.count)}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      <div>
        <SubHead>Status</SubHead>
        <div className="mb-2.5 flex items-center gap-2.5">
          {active ? (
            <Pill tone="ok">Active</Pill>
          ) : (
            <Pill tone="neutral">Retired</Pill>
          )}
          <span className="text-meta text-body">
            {active
              ? `May be chosen for new articles.`
              : `Not offered for new articles. Everything already using it keeps it.`}
          </span>
        </div>

        {change.isError && (
          <Banner tone="bad" className="mb-2.5">
            {said(change.error)}
          </Banner>
        )}
        {remove.isError && (
          <Banner tone="bad" className="mb-2.5">
            {said(remove.error)}
          </Banner>
        )}

        {/* Said before the click, not after it. What people fear when they
            retire something is that it will break what is already running —
            and the answer is no, in both directions. */}
        {active && spoken.length > 0 && (
          <p className="mb-2.5 text-meta text-body">
            {spoken
              .map(
                (one) => `${count(one.count)} ${counted(one.label, one.count)}`
              )
              .join(", ")}{" "}
            will keep using {label}. Retiring only stops it being offered for
            new ones.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            variant={active ? "soft" : "primary"}
            disabled={change.isPending || remove.isPending}
            onClick={() => change.mutate(!active)}
          >
            {change.isPending
              ? "Saving…"
              : active
                ? `Retire this ${subject}`
                : `Restore this ${subject}`}
          </Button>

          {deletable &&
            (confirming ? (
              <>
                <Button
                  variant="danger"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate()}
                >
                  {remove.isPending ? "Deleting…" : "Delete permanently"}
                </Button>
                <Button variant="quiet" onClick={() => setConfirming(false)}>
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
        {usage.data?.blocked && usage.data.total === 0 && (
          <p className="mt-2.5 text-meta text-mute">{usage.data.blocked}</p>
        )}
      </div>
    </div>
  )
}

/// A reference label as it reads after a number. The labels head a column of
/// counts, so they are plural — and "1 promotion rules" is the kind of phrase
/// that makes a reader distrust the number in front of it. Dropping a trailing
/// `s` covers every label these lists produce; the server does the same to the
/// sentence it writes.
function counted(label: string, howMany: number): string {
  const lower = label.toLowerCase()
  return howMany === 1 && lower.endsWith("s") ? lower.slice(0, -1) : lower
}

/// The server's own sentence about why a write was refused. It names the
/// articles, the promotions or the history that stopped it, and "could not
/// save" would throw all of that away.
function said(error: unknown): string {
  return error instanceof Error ? error.message : "That did not save."
}
