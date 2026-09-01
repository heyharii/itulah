import { useState } from "react"

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
import { useMember } from "@/lib/member"

/// Which card this phone is showing.
///
/// Asked once and remembered, because a member types this on the day they get
/// the card and never again. It is not a login and does not pretend to be one:
/// no password field, no "masuk", and the copy says the number is the one the
/// cashier reads out — see `lib/member.tsx` for what this value is and is not.
export function MemberGate() {
  const { remember } = useMember()
  const [value, setValue] = useState("")

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    remember(value)
  }

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <Card>
          <CardHeader>
            <CardTitle>Itulah Member</CardTitle>
            <CardDescription>
              Masukkan nomor member kamu untuk melihat poin dan riwayat belanja.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="member">Nomor member</FieldLabel>
                  <Input
                    id="member"
                    name="member"
                    autoFocus
                    required
                    autoComplete="off"
                    // A card number is digits on most cards and letters on
                    // some, so the keyboard is not forced to numeric: a member
                    // whose code has a letter in it would be unable to type it.
                    inputMode="text"
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                  />
                  <FieldDescription>
                    Nomor yang sama dengan yang kamu sebutkan di kasir.
                  </FieldDescription>
                </Field>
                <Field>
                  <Button type="submit" disabled={value.trim() === ""}>
                    Lihat poin saya
                  </Button>
                </Field>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
