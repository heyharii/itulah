import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { BellRing } from "lucide-react"

import { CentralGate } from "@/components/central-gate"
import { Button } from "@/components/ui/button"
import { CardList, Screen, Section } from "@/components/ui/screen"
import { cloud, CENTRAL_KEY_PREFIX } from "@/lib/cloud"
import { moment } from "@/lib/format"
import { queryState } from "@/lib/query-state"
import { cn } from "@/lib/utils"
import type { NotificationPage } from "@itulah/contract"

/// What head office has told this shop.
///
/// # Why this is a screen and not a bell
///
/// The console puts its count in the top bar, on screen in every module, and
/// that is right for somebody sitting at a desk. This app spends its day on a
/// counter with a customer in front of it, and a red dot above the till during
/// a queue is an interruption rather than news. So the count lives on a row in
/// the drawer, where somebody goes when they have a moment, and nothing ever
/// appears over the selling screen.
///
/// # Only two kinds of thing reach a shop
///
/// The answer to something this shop reported, and anything that names this
/// shop. That is not a filter drawn here — the server decides an audience when
/// the notification is raised, and a shop manager is simply not in the audience
/// for a supplier's price amendment. What arrives is already theirs.
export function News() {
  return (
    <CentralGate what="What head office has told you">
      <ShopNews />
    </CentralGate>
  )
}

function ShopNews() {
  const client = useQueryClient()

  const feed = useQuery({
    queryKey: [CENTRAL_KEY_PREFIX, "notifications"] as const,
    queryFn: ({ signal }) =>
      cloud.get<NotificationPage>("/api/v1/notifications?limit=50", { signal }),
  })

  const read = useMutation({
    mutationFn: (id: string) =>
      cloud.post(`/api/v1/notifications/${encodeURIComponent(id)}/read`, {}),
    onSuccess: () =>
      client.invalidateQueries({
        queryKey: [CENTRAL_KEY_PREFIX, "notifications"],
      }),
  })

  const unread = feed.data?.unread ?? 0

  return (
    <Screen>
      <Section title={unread === 0 ? "Nothing new" : `${unread} baru`}>
        {queryState(feed, {
          loading: "Asking head office…",
          render: (page) =>
            page.items.length === 0 ? (
              <p className="text-meta text-body">
                Head office has not sent this shop anything. Faults you report
                are answered here.
              </p>
            ) : (
              <CardList>
                {page.items.map((one) => (
                  <div
                    key={one.notification_id}
                    className={cn(
                      "rounded-card border bg-canvas p-3.5",
                      one.read_at === null
                        ? "border-accent/40 bg-accent/[0.04]"
                        : "border-hairline",
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <span
                        aria-hidden
                        className={cn(
                          "mt-1.5 size-1.5 shrink-0 rounded-full",
                          one.read_at === null ? "bg-accent" : "bg-hairline-2",
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-card-title font-semibold text-ink">
                          {one.title}
                        </p>
                        <p className="mt-0.5 text-meta leading-snug text-body">
                          {one.body}
                        </p>
                        <p className="mt-1 text-pill text-mute">
                          {moment(one.created_at)}
                        </p>
                      </div>
                    </div>
                    {/* No deep link out of here on purpose: this app has no
                        screen that shows a purchase order or a bill, and a
                        row that led nowhere would be worse than one that
                        plainly does not offer to. The sentence is the whole
                        message — that is why the server writes it as one. */}
                    {one.read_at === null && (
                      <Button
                        variant="ghost"
                        className="mt-2"
                        disabled={read.isPending}
                        onClick={() => read.mutate(one.notification_id)}
                      >
                        <BellRing />
                        Sudah dibaca
                      </Button>
                    )}
                  </div>
                ))}
              </CardList>
            ),
        })}
      </Section>
    </Screen>
  )
}
