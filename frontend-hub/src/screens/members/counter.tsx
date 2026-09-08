import { useMutation, useQueryClient } from "@tanstack/react-query"
import { KeyRound, UserPlus } from "lucide-react"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input } from "@/components/ui/field"
import { Sheet } from "@/components/ui/sheet"
import { Banner, Problem } from "@/components/ui/states"
import {
  enrolMember,
  issuePairingCode,
  memberKeys,
  type IssuedPairingCode,
  type MemberIdentity,
} from "@/lib/queries/members"

/// The counter's two acts: enrol a card, and activate it.
///
/// **Why these live here and not at the till.** `frontend-store-new` talks to
/// the shop's own Edge and to nothing else — that is the whole architecture of
/// the till, and it is what keeps a shop selling when the line to head office
/// is down. A member is not a property of one shop: they buy in Bekasi and in
/// Depok, the directory is central, and enrolling a card is by nature an act
/// at the centre. So it belongs to a surface that already addresses the
/// centre, and this app is responsive to a phone for exactly this kind of
/// reason.
///
/// **The rung is Cashier**, the lowest one — see `cloud/domain/auth.rs`. Not a
/// concession: both acts happen with the shopper standing there, and a loyalty
/// scheme whose sign-in needs a manager to walk over is a loyalty scheme
/// nobody signs in to.
///
/// **Nothing here reads a code back.** The six digits exist in one HTTP
/// response and are then a hash in a table. If they are lost between this
/// screen and the shopper, the answer is another code — which is why the panel
/// below offers exactly that and never a lookup.

/// Ten minutes, counted down rather than stated as a time.
///
/// The question at a counter is "have I still got it", and a reader who has to
/// subtract 14:31 from the clock on the wall will get it wrong while somebody
/// waits. Ticks locally: nothing is re-fetched, because the expiry is a fact
/// the response already carried.
function useRemaining(expiresAt: string | undefined): number | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (expiresAt === undefined) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [expiresAt])
  if (expiresAt === undefined) return null
  return Math.max(0, Math.floor((Date.parse(expiresAt) - now) / 1000))
}

function mmss(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`
}

/// The six digits, set to be read aloud.
///
/// Spaced in mono at a size that survives a counter's lighting and a shopper
/// three feet away, because that is the delivery mechanism: somebody says them
/// out loud. There is deliberately no copy button — a code on a clipboard is a
/// credential in a place nobody cleaned up, and the phone it is going to is
/// not this device.
function Code({ issued }: { issued: IssuedPairingCode }) {
  const remaining = useRemaining(issued.expires_at)
  const dead = remaining !== null && remaining === 0

  return (
    <div className="flex flex-col gap-3 rounded-card bg-soft-2 px-4 py-4">
      <div className="flex flex-col gap-1">
        <span className="text-[0.71875rem] font-medium text-mute">
          Read these out to {issued.member_id}
        </span>
        <span
          className={
            dead
              ? "font-mono text-[1.75rem] leading-none tracking-[0.35em] text-mute line-through"
              : "font-mono text-[1.75rem] leading-none tracking-[0.35em] text-ink"
          }
        >
          {issued.code}
        </span>
      </div>
      {dead ? (
        <span className="text-[0.71875rem] text-bad">
          Expired. Issue another — there is no way to look this one up again.
        </span>
      ) : (
        <span
          className={
            remaining !== null && remaining < 60
              ? "text-[0.71875rem] text-bad tabular-nums"
              : "text-[0.71875rem] text-mute tabular-nums"
          }
        >
          Good for {remaining === null ? "…" : mmss(remaining)}. The shopper
          types their card number and these six digits into the member app.
        </span>
      )}
    </div>
  )
}

/// Issue a code for a card that already exists.
///
/// Dropped into the member sheet, so the act sits on the record it is about.
/// Blocked memberships are refused by the server; the button is hidden for
/// them rather than left to fail, because a control that always errors is a
/// worse explanation than its absence.
///
/// **Key this on the member id at the call site.** The sheet stays mounted
/// when an operator clicks a different row, so without a key this component
/// keeps the state it had — and the failure is not cosmetic: request a code,
/// click the next member before it answers, and the six digits arrive into a
/// sheet showing somebody else's name. A cashier reading from that screen
/// reads the wrong card's code out loud. Resetting in an effect does not fix
/// it, because the effect runs when the row changes and the response lands
/// after that; unmounting does, because there is then nothing for the reply to
/// write into. It is the same reason `segment-form.tsx` is keyed.
export function IssueCode({
  memberId,
  blocked,
}: {
  memberId: string
  blocked: boolean
}) {
  const [issued, setIssued] = useState<IssuedPairingCode | null>(null)

  const issue = useMutation({
    mutationFn: () => issuePairingCode(memberId),
    onSuccess: setIssued,
  })

  if (blocked) return null

  return (
    <div className="flex flex-col gap-3">
      {issued && <Code issued={issued} />}
      <div>
        <Button
          variant={issued ? "ghost" : "soft"}
          onClick={() => issue.mutate()}
          disabled={issue.isPending}
        >
          <KeyRound />
          {issued ? "Issue another" : "Issue a pairing code"}
        </Button>
      </div>
      <Problem error={issue.error} />
    </div>
  )
}

/// Enrol a card, then activate it without leaving the sheet.
///
/// One sheet for two acts because they are one job at a counter: somebody is
/// standing there holding a card they want to use on their phone. Splitting
/// them across two screens is how a shop ends up with cards enrolled and never
/// activated — which the directory already has a segment for, `NEVER`, and
/// which is the most fixable failure on that screen.
export function EnrolCard({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const client = useQueryClient()
  const [memberId, setMemberId] = useState("")
  const [name, setName] = useState("")
  const [enrolled, setEnrolled] = useState<MemberIdentity | null>(null)

  // A fresh sheet every time it opens. Left alone, the card enrolled this
  // morning would still be sitting there this afternoon with its code beside
  // it.
  useEffect(() => {
    if (!open) return
    setMemberId("")
    setName("")
    setEnrolled(null)
  }, [open])

  const enrol = useMutation({
    mutationFn: () =>
      enrolMember({
        member_id: memberId.trim(),
        display_name: name.trim() === "" ? undefined : name.trim(),
      }),
    onSuccess: (member) => {
      setEnrolled(member)
      void client.invalidateQueries({ queryKey: memberKeys.all })
    },
  })

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={enrolled ? "Card enrolled" : "Enrol a card"}
      id={enrolled?.member_id}
    >
      <div className="flex flex-col gap-5">
        {enrolled === null ? (
          <>
            <p className="text-[0.78125rem] leading-relaxed text-body">
              The number printed on the card the shopper is already holding.
              Enrolling the same card twice is not a mistake — it upserts, so a
              card re-presented at a second shop keeps its history.
            </p>
            <Field
              label="Card number"
              hint="Exactly as printed. It is what the till writes onto a sale, so a number typed differently here is a different member."
            >
              <Input
                value={memberId}
                onChange={(event) => setMemberId(event.target.value)}
                placeholder="M-000123"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </Field>
            <Field
              label="Name"
              hint="Optional, and usually absent. A shopper who will not give one still gets a card; a required name is a required lie."
            >
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Left blank"
              />
            </Field>
            <Problem error={enrol.error} />
            <div>
              <Button
                variant="primary"
                onClick={() => enrol.mutate()}
                disabled={memberId.trim() === "" || enrol.isPending}
              >
                <UserPlus />
                Enrol this card
              </Button>
            </div>
          </>
        ) : (
          <>
            <Banner tone="ok">
              {enrolled.member_id} is enrolled
              {enrolled.display_name ? ` to ${enrolled.display_name}` : ""}. The
              till can attribute sales to it from now on.
            </Banner>
            <p className="text-[0.78125rem] leading-relaxed text-body">
              A card on its own earns points. The shopper only sees them once a
              phone is paired to it, and that takes a code from here — read out
              while they are still standing at the counter.
            </p>
            <IssueCode memberId={enrolled.member_id} blocked={false} />
          </>
        )}
      </div>
    </Sheet>
  )
}
