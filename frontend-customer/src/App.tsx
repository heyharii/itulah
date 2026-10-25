import { RouterProvider } from "@tanstack/react-router"

import { CentralMark } from "@/components/matte"
import { PairingForm } from "@/components/pairing-form"
import { SessionProvider, useMemberSession, useSignOut } from "@/lib/session"
import { router } from "@/router"

/// One gate, where there used to be two.
///
/// The old shape was an operator username and password, and then a "type your
/// member number" box. The first was a credential no shopper had; the second
/// was not a credential at all. Both are replaced by one sign-in: six digits
/// WhatsApp sent to the member's number — or, for a card with no phone behind
/// it, six digits from the cashier — after which the session cookie says who
/// this is and nothing on the page has to assert it.
export default function App() {
  // Three states, not two. While the query is pending nobody has been asked
  // anything yet, and showing the sign-in during that moment would ask an
  // already-signed-in phone to sign in again.
  const session = useMemberSession()
  const { mutate: signOut } = useSignOut()

  if (session.isPending) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-backdrop p-6">
        {/* The mark, breathing in once rather than a spinner: most of the
            time this lasts a few hundred milliseconds and a spinner that
            flashes on and off reads as a glitch. */}
        <CentralMark className="size-14 motion-safe:animate-[page-fade_600ms_var(--ease-out)_both]" />
        <span className="sr-only">Memeriksa…</span>
      </main>
    )
  }

  // A refusal that is not "no session" — the node being unreachable, or
  // refusing for some other reason. A bare sign-in form here would fail again
  // for a cause nobody watching could see.
  if (session.isError) {
    return (
      <main className="flex min-h-svh flex-col items-center justify-center gap-4 bg-backdrop p-6 text-center">
        <CentralMark className="size-14 opacity-50 grayscale" />
        <p role="alert" className="max-w-[17rem] text-nav text-body">
          Tidak dapat menghubungi server. Coba lagi sebentar lagi.
        </p>
      </main>
    )
  }

  if (session.data === null) {
    return <PairingForm />
  }

  return (
    <SessionProvider value={{ member: session.data, signOut }}>
      <RouterProvider router={router} />
    </SessionProvider>
  )
}
