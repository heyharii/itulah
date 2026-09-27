import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { BellOff, BellRing, Download, Share, SquarePlus } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  disablePush,
  enablePush,
  permission,
  pushEnabledFor,
  pushPublicKey,
  pushSupport,
} from "@/lib/push"
import { useInstall } from "@/lib/pwa"
import { useIdentity } from "@/lib/session"
import { cn } from "@/lib/utils"

/// "Aktifkan notifikasi", and everything that has to be true first.
///
/// Shown where notifications are read — the bell's popup on a desk, the
/// Notifications screen on a phone — because that is where somebody wonders
/// whether they will be told. Never a prompt on load: the browser's permission
/// question appears only after this button is pressed (see `lib/push.ts`).
///
/// Every state says a plain sentence rather than hiding the control, so a
/// person who is not being woken can see why: this browser cannot, the server
/// is not set up, they blocked it, or — on an iPhone — it has to be installed
/// first.

const keys = {
  server: ["push", "public-key"] as const,
  enabled: (username: string) => ["push", "enabled", username] as const,
}

function Note({
  icon: Icon = BellOff,
  children,
}: {
  icon?: typeof BellOff
  children: React.ReactNode
}) {
  return (
    <p className="flex gap-2 text-[0.875rem] leading-snug text-body">
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-line-ico" />
      <span>{children}</span>
    </p>
  )
}

/// The three steps, for Safari on an iPhone or iPad. Push reaches an iOS
/// web app only once it is on the Home Screen and opened from there (iOS
/// 16.4 and later), so that is what is asked for, in the order it is done.
function AddToHomeScreen() {
  return (
    <div className="flex flex-col gap-2">
      <Note icon={BellRing}>
        Di iPhone dan iPad, notifikasi hanya bisa diterima setelah aplikasi ini
        dipasang di layar utama.
      </Note>
      <ol className="ml-6 flex list-decimal flex-col gap-1 text-[0.875rem] leading-snug text-body">
        <li>
          Ketuk{" "}
          <Share aria-label="Bagikan" className="inline size-4 align-[-3px]" />{" "}
          <span className="font-medium text-ink">Bagikan</span> di Safari.
        </li>
        <li>
          Pilih{" "}
          <SquarePlus aria-hidden className="inline size-4 align-[-3px]" />{" "}
          <span className="font-medium text-ink">Tambah ke Layar Utama</span>.
        </li>
        <li>
          Buka <span className="font-medium text-ink">Central</span> dari layar
          utama, lalu ketuk{" "}
          <span className="font-medium text-ink">Aktifkan notifikasi</span> di
          sini.
        </li>
      </ol>
    </div>
  )
}

function InstallButton() {
  const install = useInstall()
  if (!install.canInstall) return null
  return (
    <Button size="sm" variant="quiet" onClick={() => void install.install()}>
      <Download />
      Pasang aplikasi
    </Button>
  )
}

export function PushControl({ className }: { className?: string }) {
  const client = useQueryClient()
  const username = useIdentity().data?.username ?? ""
  const support = pushSupport()
  // Read at render: the browser owns this answer, and the person can change
  // it in site settings between two renders.
  const [asked, setAsked] = useState<NotificationPermission>(permission)
  const [problem, setProblem] = useState<string | null>(null)

  const server = useQuery({
    queryKey: keys.server,
    queryFn: ({ signal }) => pushPublicKey(signal),
    enabled: support === "ready",
    staleTime: 5 * 60_000,
  })
  const enabled = useQuery({
    queryKey: keys.enabled(username),
    queryFn: () => pushEnabledFor(username),
    enabled: support === "ready" && username !== "",
  })

  const turnOn = useMutation({
    mutationFn: () => enablePush(username, server.data?.public_key),
    onMutate: () => setProblem(null),
    onSuccess: (answer) => setAsked(answer),
    onError: (error) =>
      setProblem(
        error instanceof Error && error.message !== ""
          ? error.message
          : "Notifikasi tidak bisa diaktifkan. Coba lagi."
      ),
    onSettled: () =>
      void client.invalidateQueries({ queryKey: keys.enabled(username) }),
  })
  const turnOff = useMutation({
    mutationFn: disablePush,
    onSettled: () =>
      void client.invalidateQueries({ queryKey: keys.enabled(username) }),
  })

  let body: React.ReactNode
  if (support === "ios-needs-install") {
    body = <AddToHomeScreen />
  } else if (support === "unsupported") {
    body = (
      <Note>
        Browser ini tidak bisa menerima notifikasi push. Daftar ini tetap
        diperbarui selama halamannya terbuka.
      </Note>
    )
  } else if (server.data !== undefined && !server.data.enabled) {
    body = <Note>Notifikasi push belum diaktifkan di server ini.</Note>
  } else if (asked === "denied" || permission() === "denied") {
    body = (
      <Note>
        Notifikasi diblokir untuk situs ini. Izinkan lewat pengaturan situs di
        browser, lalu muat ulang halaman.
      </Note>
    )
  } else if (enabled.data === true) {
    body = (
      <div className="flex items-center justify-between gap-2">
        <Note icon={BellRing}>Notifikasi aktif di perangkat ini.</Note>
        <Button
          size="sm"
          variant="quiet"
          pending={turnOff.isPending}
          onClick={() => turnOff.mutate()}
        >
          Matikan
        </Button>
      </div>
    )
  } else {
    body = (
      <div className="flex flex-col gap-2">
        <Note icon={BellRing}>
          Dapatkan pemberitahuan di perangkat ini, juga saat aplikasi tertutup.
        </Note>
        <div>
          <Button
            size="sm"
            variant="ghost"
            pending={turnOn.isPending || server.isPending}
            disabled={username === ""}
            onClick={() => turnOn.mutate()}
          >
            <BellRing />
            {turnOn.isPending ? "Mengaktifkan…" : "Aktifkan notifikasi"}
          </Button>
        </div>
        {asked === "default" && turnOn.isSuccess && (
          <Note>
            Izin belum diberikan. Tekan lagi bila ingin menerima notifikasi.
          </Note>
        )}
        {problem !== null && (
          <p role="alert" className="text-[0.875rem] text-bad-fg">
            {problem}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {body}
      <div className="empty:hidden">
        <InstallButton />
      </div>
    </div>
  )
}
