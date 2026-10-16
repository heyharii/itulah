import { PageContent } from "@/components/shell/app-shell"
import { PageHeader } from "@/components/ui/page-header"
import { LoadingState } from "@/components/ui/states"

/// What a Finance screen draws while its figures are still on the way.
///
/// The screens read their first data with `useSuspenseQuery` inside a
/// `<Suspense>` (`lib/prefetch.ts` says why: a plain `useQuery` of something
/// the server already started renders one thing there and another here). This
/// is the boundary's fallback: the page's own head, which needs nothing, over
/// the quiet line the screen used to show while it was pending. The screen's
/// real head replaces it in place, so nothing moves when the data lands.
export function ScreenPending({
  crumb,
  title,
  className,
  children,
}: {
  crumb?: React.ReactNode
  title: React.ReactNode
  /// The head's own class, for the screens that hide it on a phone (the top
  /// bar already names the screen there).
  className?: string
  /// The sentence under the head, the screen's usual loading line.
  children?: React.ReactNode
}) {
  return (
    <PageContent>
      <PageHeader crumb={crumb} title={title} className={className} />
      <LoadingState>{children}</LoadingState>
    </PageContent>
  )
}
