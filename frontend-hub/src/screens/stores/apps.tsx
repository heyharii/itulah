import { Download } from "lucide-react"

import { PageContent } from "@/components/shell/app-shell"
import { button } from "@/components/ui/button-style"
import { Card } from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
import { Section } from "@/screens/stores/shared"

/// Every Central desktop app, and where it is downloaded (owner, 2026-10-30).
///
/// The hub is a browser surface; the shop and head office also run it as
/// applications — Central itself on a head-office PC, and at a shop the
/// server, the shop's own app, the tills and the warehouse screen. This is
/// the one page that names them all, so nobody has to be sent a link in a
/// message and nobody guesses which installer a machine needs.
///
/// The addresses are the published stable names, not a versioned path: the
/// bucket replaces them in place when a build comes out (`desktop/README.md`
/// and `deploy/windows/*`), so a link written here never goes stale. The
/// store server's own copy of the same rule is `store_installer_url`
/// (`backend/src/cloud/postgres/stores.rs`), which the Server tab reads.
const BUCKET = "https://storage.googleapis.com/itulah-central-desktop"

interface AppDownload {
  /// The platform, as the button says it.
  os: string
  /// What the file is, where the platform alone is not enough.
  note: string
  href: string
}

interface App {
  name: string
  /// What it is, for the person choosing between them.
  what: string
  /// The machine it runs on.
  where: string
  /// One line that only this app needs said.
  note?: string
  downloads: readonly AppDownload[]
}

const HEAD_OFFICE: readonly App[] = [
  {
    name: "Central",
    what: "The hub in its own window: a tray, native notifications, printing and its own updates, so a hub deploy reaches the desktop without a new installer.",
    where: "Head office PC",
    note: "The macOS build is for Apple silicon. On an Intel Mac, open the hub in the browser.",
    downloads: [
      { os: "macOS", note: "Apple silicon", href: `${BUCKET}/Central.dmg` },
      { os: "Windows", note: "64-bit", href: `${BUCKET}/Central-setup.exe` },
    ],
  },
]

const AT_THE_SHOPS: readonly App[] = [
  {
    name: "Central Store Server",
    what: "The shop's own server: the authority for its stock, prices and sales, and the machine every till and the shop app join.",
    where: "One per store · Windows PC or mini PC",
    note: "Install this first. Its install code is issued on the store's Server tab.",
    downloads: [
      { os: "Windows", note: "MSI", href: `${BUCKET}/store-server/latest.msi` },
    ],
  },
  {
    name: "Central Store",
    what: "The shop's back office: receiving, counts, stock and the day's takings, read from the store server.",
    where: "Back-office PC · Windows",
    downloads: [
      {
        os: "Windows",
        note: "64-bit",
        href: `${BUCKET}/store-app/Central-Store-setup.exe`,
      },
    ],
  },
  {
    name: "Central POS",
    what: "The counter: the till, its drawer, receipt printer and scanner, joined to the store server.",
    where: "Each till · Windows",
    downloads: [
      {
        os: "Windows",
        note: "64-bit",
        href: `${BUCKET}/pos/Central-POS-setup.exe`,
      },
    ],
  },
]

const AT_THE_WAREHOUSE: readonly App[] = [
  {
    name: "Central Gudang",
    what: "The warehouse screen: receiving, sending to the shops and counts, on the same store server.",
    where: "Warehouse PC · Windows",
    downloads: [
      {
        os: "Windows",
        note: "64-bit",
        href: `${BUCKET}/gudang/Central-Gudang-setup.exe`,
      },
    ],
  },
]

/// Stores › Desktop apps — the installers, nothing else.
///
/// A shop is installed in one order, and the page keeps it: the server, then
/// the shop app and the tills that join it. The hub's own desktop app stands
/// apart, because it belongs to head office rather than to a shop.
export function StoreApps() {
  return (
    <PageContent>
      <PageHeader title="Desktop apps" />
      <div className="flex max-w-3xl flex-col gap-7">
        <Section title="Head office">
          <Card className="divide-y divide-hairline">
            {HEAD_OFFICE.map((app) => (
              <AppRow key={app.name} app={app} />
            ))}
          </Card>
        </Section>

        <Section title="At the shops">
          <Card className="divide-y divide-hairline">
            {AT_THE_SHOPS.map((app) => (
              <AppRow key={app.name} app={app} />
            ))}
          </Card>
        </Section>

        <Section title="At the warehouse">
          <Card className="divide-y divide-hairline">
            {AT_THE_WAREHOUSE.map((app) => (
              <AppRow key={app.name} app={app} />
            ))}
          </Card>
        </Section>

        <p className="text-[0.9375rem] text-mute">
          Windows installers need no key. At a shop, a machine joins the server
          it finds on the shop&rsquo;s network, and the first supervisor
          approves it there.
        </p>
      </div>
    </PageContent>
  )
}

function AppRow({ app }: { app: App }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-5 py-4">
      <div className="max-w-xl min-w-0">
        <div className="text-[0.9375rem] font-medium text-ink">{app.name}</div>
        <p className="mt-0.5 text-[0.9375rem] text-body">{app.what}</p>
        <p className="mt-1 text-[0.9375rem] text-mute">{app.where}</p>
        {app.note && (
          <p className="mt-0.5 text-[0.9375rem] text-mute">{app.note}</p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {app.downloads.map((download) => (
          <a
            key={download.href}
            href={download.href}
            className={button({ variant: "ghost" })}
            aria-label={`Download ${app.name} for ${download.os}`}
            title={`${app.name} for ${download.os} · ${download.note}`}
          >
            <Download />
            {download.os}
          </a>
        ))}
      </div>
    </div>
  )
}
