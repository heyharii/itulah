import { ApiError } from "@itulah/contract/client"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useRef, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Field, Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { pendingLabel } from "@/components/ui/pending-label"
import { Fact, Facts } from "@/components/ui/sheet"
import {
  ErrorState,
  LoadingState,
  NoAccessState,
  Problem,
} from "@/components/ui/states"
import { EMPTY, dayTime, type Tone } from "@/lib/format"
import { whatsappNumber } from "@/lib/queries/invitations"
import { svgDataUri } from "@/lib/queries/stores"
import {
  sendWhatsAppTest,
  unlinkWhatsApp,
  whatsappKeys,
  whatsappPollMs,
  whatsappStatus,
  type WhatsAppStatus,
} from "@/lib/queries/whatsapp"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { StopDialog } from "@/screens/stores/stop-dialog"

/// Head office's WhatsApp number — the one that sends shoppers their one-time
/// codes: member registration at the till, member-app sign-in, and points
/// redemption. An Admin pairs it here by scanning a QR with the company phone,
/// sends a test to see the line works, and unlinks it to pair another.
///
/// It is WhatsApp Web driven by a browser on the server, for now, so what the
/// page shows is the gateway's own state, asked every 10 s — and every 3 s
/// while a pairing is on its way, so the QR in front of the phone is the live
/// one (`whatsappPollMs`).

const STATE_LABEL: Readonly<Record<string, string>> = {
  CONNECTED: "Connected",
  QR: "Waiting for scan",
  STARTING: "Starting",
  DISCONNECTED: "Disconnected",
  OFF: "Not set up",
  UNREACHABLE: "Gateway not answering",
}

const STATE_TONE: Readonly<Record<string, Tone>> = {
  CONNECTED: "ok",
  QR: "warn",
  STARTING: "info",
  DISCONNECTED: "bad",
  OFF: "neutral",
  UNREACHABLE: "bad",
}

export function WhatsApp() {
  const client = useQueryClient()
  // Unlinking drops the gateway back to a new QR within seconds, and it may
  // say "Disconnected" for a moment first: ask every 3 s through that window
  // instead of waiting out the 10.
  const pairingUntil = useRef(0)
  const status = useQuery({
    queryKey: whatsappKeys.status(),
    queryFn: ({ signal }) => whatsappStatus(signal),
    refetchInterval: (query) =>
      Date.now() < pairingUntil.current
        ? 3_000
        : whatsappPollMs(query.state.data?.state),
  })

  function unlinked() {
    pairingUntil.current = Date.now() + 30_000
    void client.invalidateQueries({ queryKey: whatsappKeys.status() })
  }

  return (
    <PageContent>
      <PageHeader crumb="System" title="WhatsApp" />

      {status.data !== undefined ? (
        <Gateway status={status.data} onUnlinked={unlinked} />
      ) : status.isError ? (
        status.error instanceof ApiError && status.error.status === 403 ? (
          <NoAccessState what="head office’s WhatsApp" />
        ) : (
          <ErrorState
            error={status.error}
            onRetry={() => void status.refetch()}
          />
        )
      ) : (
        <LoadingState>Loading WhatsApp…</LoadingState>
      )}
    </PageContent>
  )
}

function Gateway({
  status,
  onUnlinked,
}: {
  status: WhatsAppStatus
  onUnlinked: () => void
}) {
  // No gateway on this server: nothing to pair, test or unlink.
  if (status.state === "OFF") {
    return (
      <p className="text-[0.9375rem] text-body">
        No WhatsApp gateway is configured on this server.
      </p>
    )
  }

  const number = readAloud(status.number)

  return (
    <div className="flex max-w-xl flex-col gap-8">
      <Facts>
        <Fact term="Status">
          <span className="inline-flex items-center gap-2">
            <Dot tone={STATE_TONE[status.state] ?? "neutral"} />
            {STATE_LABEL[status.state] ?? status.state}
          </span>
        </Fact>
        <Fact term="Number">{number ?? EMPTY}</Fact>
        <Fact term="Name">{status.name ?? EMPTY}</Fact>
        <Fact term="Since">
          {status.since === null ? EMPTY : dayTime(status.since)}
        </Fact>
        {status.last_error !== null && status.last_error !== "" && (
          <Fact term="Last error" wide>
            {status.last_error}
          </Fact>
        )}
      </Facts>

      {status.state === "QR" && status.qr_svg !== null && (
        <div>
          {/* A scanner wants dark on light, so the code keeps a white ground
              whatever the theme is. The SVG is our own backend's drawing, put
              in an <img> as a data URI and never into the page's markup. */}
          <div className="size-[16.25rem] rounded-card border border-hairline bg-white p-3">
            <img
              src={svgDataUri(status.qr_svg)}
              alt="QR code to link head office’s WhatsApp"
              className="size-full"
            />
          </div>
          <p className="mt-3 text-[0.9375rem] text-body">
            On the company phone: WhatsApp › Linked devices › Link a device,
            then scan.
          </p>
        </div>
      )}

      {status.state === "CONNECTED" && (
        <Connected number={number} onUnlinked={onUnlinked} />
      )}
    </div>
  )
}

/// What an Admin does with a number that is linked: send a test to see it
/// works, or unlink it.
function Connected({
  number,
  onUnlinked,
}: {
  number: string | null
  onUnlinked: () => void
}) {
  const [to, setTo] = useState("")
  const [unlinking, setUnlinking] = useState(false)
  const ready = whatsappNumber(to) !== null

  const test = useMutation({
    mutationFn: () => sendWhatsAppTest(to.trim()),
    onSuccess: (sent) =>
      toast.success("Test sent", { description: sent.sent_to }),
  })

  const unlink = useMutation({
    mutationFn: () => unlinkWhatsApp(),
    onSuccess: () => {
      setUnlinking(false)
      onUnlinked()
    },
  })

  return (
    <>
      <form
        className="flex max-w-sm flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (ready && !test.isPending) test.mutate()
        }}
      >
        <Field label="Phone number">
          <Input
            type="tel"
            inputMode="tel"
            autoComplete="off"
            placeholder="0812 3456 7890"
            value={to}
            onChange={(event) => {
              setTo(event.target.value)
              if (test.isError) test.reset()
            }}
          />
        </Field>
        <Problem error={test.error} />
        <div>
          <Button
            type="submit"
            variant="primary"
            pending={test.isPending}
            disabled={!ready}
          >
            {test.isPending ? pendingLabel("Send test") : "Send test"}
          </Button>
        </div>
      </form>

      <div>
        <Button variant="destructive" onClick={() => setUnlinking(true)}>
          Unlink number
        </Button>
      </div>

      <StopDialog
        open={unlinking}
        onOpenChange={(open) => {
          setUnlinking(open)
          if (!open) unlink.reset()
        }}
        title={`Unlink ${number ?? "this number"}?`}
        sub="Codes stop until a number is linked again."
        facts={[]}
        action="Unlink number"
        pending={unlink.isPending}
        error={unlink.error}
        onConfirm={() => unlink.mutate()}
      />
    </>
  )
}

/// A state's small coloured dot, as the Stores pages draw a server's.
function Dot({ tone }: { tone: Tone }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-[8px] shrink-0 rounded-full",
        tone === "ok" && "bg-ok",
        tone === "bad" && "bg-bad",
        tone === "warn" && "bg-warn",
        tone === "info" && "bg-info",
        tone === "neutral" && "bg-mute"
      )}
    />
  )
}

/// `628123456789` as it is read aloud: `+62 812 3456 789`.
function readAloud(number: string | null): string | null {
  if (number === null) return null
  const digits = number.replace(/\D/g, "")
  if (digits === "") return null
  if (!digits.startsWith("62")) return `+${digits}`
  const rest = digits.slice(2)
  return [
    "+62",
    rest.slice(0, 3),
    rest.slice(3, 7),
    rest.slice(7),
  ]
    .filter((part) => part !== "")
    .join(" ")
}
