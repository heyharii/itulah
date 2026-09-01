import { createFileRoute, redirect } from "@tanstack/react-router"

/** The suite has no landing page of its own — open the default app. */
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/customers" })
  },
})
