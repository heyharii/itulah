import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input } from "@/components/ui/field"
import { ActionBar, Screen, Section } from "@/components/ui/screen"
import { Banner } from "@/components/ui/states"
import { describe } from "@/lib/errors"
import { useChangePassword, useIdentity } from "@/lib/session"

/// Changing your own password on this node.
///
/// **It signs you out**, and the screen says so before the press rather than
/// after: `edge/http.rs::change_password` answers through
/// `cleared_auth_response`, which clears the session and the CSRF cookie. A
/// person who was not told would press it mid-shift and find the next thing they
/// tapped refused for no visible reason.
///
/// Work already in the outbox survives it — the queue is on disk, not in the
/// session, and a 401 is a retryable failure there precisely so that a password
/// change does not throw away somebody's counting.
export function NodeSandi() {
  const person = useIdentity().data ?? null
  const change = useChangePassword()
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [again, setAgain] = useState("")

  const mismatch = again !== "" && next !== again
  const ready =
    current !== "" && next !== "" && next === again && !change.isPending

  return (
    <>
      <Screen foot="none">
        <div className="pt-1 pb-4">
          <h2 className="text-title font-semibold text-ink">
            {person?.display_name ?? "Akun ini"}
          </h2>
          <p className="mt-0.5 text-meta text-body">
            Mengganti sandi akan mengeluarkan Anda dari node ini. Pekerjaan yang
            sudah tersimpan di HP tetap aman dan tetap terkirim.
          </p>
        </div>

        {change.isError && (
          <Banner tone="bad" className="mb-4">
            {describe(change.error)}
          </Banner>
        )}

        <Section>
          <div className="flex flex-col gap-4">
            <Field label="Sandi sekarang">
              <Input
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(event) => setCurrent(event.target.value)}
              />
            </Field>
            <Field label="Sandi baru">
              <Input
                type="password"
                autoComplete="new-password"
                value={next}
                onChange={(event) => setNext(event.target.value)}
              />
            </Field>
            <Field
              label="Ulangi sandi baru"
              problem={mismatch ? "Dua isian ini belum sama." : undefined}
            >
              <Input
                type="password"
                autoComplete="new-password"
                invalid={mismatch}
                value={again}
                onChange={(event) => setAgain(event.target.value)}
              />
            </Field>
          </div>
        </Section>
      </Screen>

      <ActionBar>
        <Button
          variant="primary"
          size="lg"
          block
          disabled={!ready}
          onClick={() => change.mutate({ current, next })}
        >
          {change.isPending ? "Mengganti…" : "Ganti sandi & keluar"}
        </Button>
      </ActionBar>
    </>
  )
}
