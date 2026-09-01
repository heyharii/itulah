/**
 * Owns the visible boundary between an Internal-backed screen and a prototype
 * surface. A local fixture may remain useful for UI work, but it must never
 * look like an authoritative backend read or write.
 */

import { Icon, paths } from "@/components/dashboard/parts"

export function PreviewNotice({
  title = "Preview data",
  children,
}: {
  title?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex shrink-0 items-start gap-2 border-b border-honey/20 bg-honey/5 px-3.5 py-2 text-[11px] leading-[1.45] text-ink-3">
      <Icon path={paths.alert} size={14} width={1.8} className="mt-px shrink-0 text-honey" />
      <span>
        <span className="font-semibold text-ink-2">{title} · </span>
        {children}
      </span>
    </div>
  )
}

