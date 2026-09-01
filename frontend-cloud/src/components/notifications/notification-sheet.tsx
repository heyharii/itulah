import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import {
  markAllNotificationsRead,
  markNotificationRead,
  notificationsKey,
  notificationTarget,
  useNotifications,
} from "@/lib/notifications"
import { cn } from "@/lib/utils"
import type { Notification } from "@itulah/contract"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Bell } from "lucide-react"

/// Work that came looking for you.
///
/// A sheet rather than a route, for the same reason the basket is one: reading
/// what arrived is something you do in the middle of doing something else, and
/// a route change would throw away the screen you were working on.
export function NotificationSheet({ children }: { children: React.ReactNode }) {
  return (
    <Sheet>
      <SheetTrigger render={children as never} />
      <SheetContent side="right" className="sm:max-w-md">
        <SheetTitle className="sr-only">Notifications</SheetTitle>
        <SheetDescription className="sr-only">
          Things somebody has to decide or do, newest first.
        </SheetDescription>
        <NotificationPanel />
      </SheetContent>
    </Sheet>
  )
}

function NotificationPanel() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const notifications = useNotifications()
  const items = notifications.data?.items ?? []
  const unread = notifications.data?.unread ?? 0

  const refresh = () => queryClient.invalidateQueries({ queryKey: notificationsKey() })
  const read = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => void refresh(),
  })
  const readAll = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => void refresh(),
  })

  const open = (notification: Notification) => {
    // Marked read because it was opened, not because a button was pressed.
    // Reading the thing is what dealing with it looks like.
    if (notification.read_at === null) read.mutate(notification.notification_id)
    const target = notificationTarget(notification)
    if (target !== null) void navigate(target as never)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Right padding leaves the sheet's own close button somewhere to be:
          without it "Mark all read" sits underneath the X. */}
      <div className="flex items-center justify-between gap-3 border-b py-3 pr-11 pl-3.5">
        <div className="min-w-0">
          <h2 className="text-sm font-medium">Notifications</h2>
          <p className="text-muted-foreground text-[11px]">
            {notifications.isPending
              ? "loading…"
              : unread === 0
                ? "Nothing waiting"
                : `${unread} unread`}
          </p>
        </div>
        {unread > 0 && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => readAll.mutate()}
            disabled={readAll.isPending}
          >
            Mark all read
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {notifications.isError ? (
          <p className="text-destructive p-4 text-center text-xs">
            The notifications could not be loaded.
          </p>
        ) : items.length === 0 ? (
          <p className="text-muted-foreground p-6 text-center text-xs">
            {notifications.isPending
              ? "Loading…"
              : "Nothing has needed your attention yet. Price queries from a warehouse and deliveries waiting to be named will appear here."}
          </p>
        ) : (
          <ul>
            {items.map((notification) => (
              <li key={notification.notification_id}>
                <button
                  type="button"
                  onClick={() => open(notification)}
                  className={cn(
                    "hover:bg-muted/60 flex w-full flex-col items-start gap-1 border-b px-3.5 py-3 text-left transition-colors",
                    notification.read_at === null && "bg-amber-500/5",
                  )}
                >
                  <span className="flex w-full items-center gap-2">
                    {/* The one mark that says "not dealt with". Colour alone
                        would leave a colour-blind reader with no signal, so the
                        row also carries the timestamp and the dot has a label. */}
                    {notification.read_at === null && (
                      <span
                        aria-label="Unread"
                        className="size-1.5 shrink-0 rounded-full bg-amber-600"
                      />
                    )}
                    <span className="truncate text-xs font-medium">{notification.title}</span>
                    <span className="text-muted-foreground ml-auto shrink-0 font-mono text-[10px]">
                      {when(notification.created_at)}
                    </span>
                  </span>
                  <span className="text-muted-foreground text-[11px] leading-relaxed">
                    {notification.body}
                  </span>
                  {notification.origin_id !== null && (
                    <span className="text-muted-foreground font-mono text-[10px]">
                      {notification.origin_id}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/// How long ago, in the shortest form that is still true.
function when(value: string): string {
  const seconds = Math.round((Date.now() - Date.parse(value)) / 1000)
  if (seconds < 60) return "just now"
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86_400)}d`
}

/// The rail's bell, and the number that makes it worth looking at.
export function NotificationRailIcon() {
  const notifications = useNotifications()
  const unread = notifications.data?.unread ?? 0
  return (
    <>
      <Bell className={cn("size-5", unread > 0 && "text-amber-600")} />
      {unread > 0 && (
        <span className="bg-amber-600 absolute -top-0.5 -right-0.5 grid min-w-4 place-items-center rounded-full px-1 font-mono text-[10px] leading-4 font-medium text-white">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </>
  )
}
