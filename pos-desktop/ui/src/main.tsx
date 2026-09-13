import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { App } from "@/app"
import "@/pos.css"

const root = document.getElementById("root")
if (root === null) throw new Error("the counter window has no root element")
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
