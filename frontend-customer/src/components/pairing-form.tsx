import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { cacheKey, member } from "@/lib/api"
import { useNodeIdentity } from "@/lib/session"
import { ApiError } from "@itulah/contract/client"

/// Connecting a phone to a card.
///
/// This screen replaces two: an operator username and password that no shopper
/// ever had, and a "type your member number" box that was not a credential and
/// said so in its own comments — anybody who guessed a number could read that
/// member's purchases.
///
/// What is asked for now is the card number AND six digits the cashier reads
/// out at the counter. That pair proves the thing that actually matters: the
/// card is in this person's hand, in the shop, in front of an employee. It is
/// deliberately not a code sent to a phone number — in this market prepaid
/// numbers change often and operators recycle them after a couple of months,
/// so whoever was issued a recycled number would inherit the previous holder's
/// history.
export function PairingForm() {
  const client = useQueryClient()
  const where = useNodeIdentity()
  const [memberId, setMemberId] = useState("")
  const [code, setCode] = useState("")

  const pair = useMutation({
    mutationFn: () => member.pair(memberId.trim(), code.trim()),
    onSuccess: (session) => {
      // The response already carries the member the server just recognised, so
      // writing it beats asking again — and it clears the failure with it.
      client.setQueryData(cacheKey.me(), session.member)
    },
  })

  // The server writes its refusals in English, for the people who run the
  // system. A shopper reading "member number or code does not match" in the
  // middle of an Indonesian screen learns nothing, so the status becomes a
  // sentence instead — the same bargain `states.tsx` makes.
  const status = pair.error instanceof ApiError ? pair.error.status : 0
  const problem =
    pair.error === null
      ? null
      : status === 401
        ? "Nomor member atau kodenya tidak cocok. Coba lagi, atau minta kode baru ke kasir."
        : status === 0 || status >= 500
          ? "Server sedang bermasalah atau tidak terjangkau. Coba lagi sebentar lagi."
          : "Belum bisa dihubungkan sekarang."

  const ready = memberId.trim() !== "" && code.trim().length === 6

  return (
    <main className="flex min-h-svh items-center justify-center bg-backdrop p-6">
      <div className="w-full max-w-sm">
        <Card>
          <CardHeader>
            <CardTitle>Hubungkan kartu member</CardTitle>
            <CardDescription>
              Minta kodenya ke kasir saat kamu belanja. Kasir akan menyebutkan 6
              angka.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(event) => {
                event.preventDefault()
                pair.mutate()
              }}
            >
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="member">Nomor member</FieldLabel>
                  <Input
                    id="member"
                    name="member"
                    autoFocus
                    required
                    autoComplete="off"
                    // Not forced to numeric: most cards are digits and some
                    // carry a letter, and a member whose code has one would be
                    // unable to type it on a numeric keypad.
                    inputMode="text"
                    value={memberId}
                    onChange={(event) => setMemberId(event.target.value)}
                  />
                  <FieldDescription>
                    Nomor yang tercetak di kartu kamu.
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="code">Kode dari kasir</FieldLabel>
                  <Input
                    id="code"
                    name="code"
                    required
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    maxLength={6}
                    // Typed by somebody standing at a counter with a queue
                    // behind them: spaced out, so a wrong digit is easy to see.
                    className="text-center tracking-[0.4em]"
                    placeholder="000000"
                    value={code}
                    onChange={(event) =>
                      setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                  />
                  <FieldDescription>
                    Berlaku 10 menit. Kalau kedaluwarsa, minta lagi ke kasir.
                  </FieldDescription>
                </Field>
                {problem !== null && (
                  <FieldDescription role="alert" className="font-medium text-bad-fg">
                    {problem}
                  </FieldDescription>
                )}
                <Field>
                  <Button
                    type="submit"
                    variant="dark"
                    block
                    disabled={!ready || pair.isPending}
                  >
                    {pair.isPending ? "Menghubungkan…" : "Hubungkan"}
                  </Button>
                  <FieldDescription className="text-center">
                    Sekali saja. Setelah terhubung, poin kamu langsung terlihat
                    setiap kali membuka aplikasi ini.
                  </FieldDescription>
                </Field>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
        {where.data != null && (
          <p className="mt-3 text-center text-meta text-mute">
            {where.data.node_id} · {where.data.node_role}
          </p>
        )}
      </div>
    </main>
  )
}
