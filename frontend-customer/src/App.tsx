import { RouterProvider } from "@tanstack/react-router"

import { PairingForm } from "@/components/pairing-form"
import { SessionProvider, useMemberSession, useSignOut } from "@/lib/session"
import { router } from "@/router"

/// One gate, where there used to be two.
///
/// The old shape was an operator username and password, and then a "type your
/// member number" box. The first was a credential no shopper had; the second
/// was not a credential at all. Both are replaced by one pairing: a card
/// number and six digits from the cashier, after which the session cookie says
/// who this is and nothing on the page has to assert it.
export default function App() {
  // Three states, not two. While the query is pending nobody has been asked
  // anything yet, and showing the pairing form during that moment would ask an
  // already-paired phone to be paired again.
  const session = useMemberSession()
  const { mutate: signOut } = useSignOut()

  if (session.isPending) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-backdrop p-6">
        <p className="text-body">Memeriksa…</p>
      </main>
    )
  }

  // A refusal that is not "no session" — the node being unreachable, or
  // refusing for some other reason. A bare pairing form here would fail again
  // for a cause nobody watching could see.
  if (session.isError) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-backdrop p-6">
        <p role="alert" className="max-w-sm text-center text-bad-fg">
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
