import "../../frontend-hub/src/styles/index.css"
import "./prototype.css"

import type { Metadata } from "next"
import type { ReactNode } from "react"

export const metadata: Metadata = {
  title: "Central Dashboard",
  description: "Purchase Orders and Receiving prototype",
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  )
}
