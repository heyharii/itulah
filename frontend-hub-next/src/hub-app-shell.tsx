import type { ReactNode } from "react"

export function PageContent({
  fill = false,
  children,
}: {
  fill?: boolean
  children: ReactNode
}) {
  return (
    <div
      className={`mx-auto max-w-[100rem] px-4 pt-4 pb-10 md:px-8 md:pt-7 md:pb-16${fill ? " flex h-full min-h-0 flex-col pb-4 md:pb-6" : ""}`}
    >
      {children}
    </div>
  )
}
