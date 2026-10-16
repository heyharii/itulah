import { randomUUID } from "node:crypto"
import { cookies } from "next/headers"

export default async function SessionProbePage() {
  const cookieValue = (await cookies()).get("frc-probe")?.value ?? "anonymous"
  return (
    <main
      data-probe="request-time-cookie"
      data-cookie-value={cookieValue}
      data-render-id={randomUUID()}
      data-records="synthetic-only"
    >
      <h1>Per-request session probe</h1>
      <p>This route only echoes a synthetic probe cookie.</p>
    </main>
  )
}
