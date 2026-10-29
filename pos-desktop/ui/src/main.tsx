import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { App } from "@/app"
import { isGudang } from "@/edition"
import "@/pos.css"

// One index.html for every edition; the window names the app it is.
if (isGudang) document.title = "Central Gudang"

const root = document.getElementById("root")
if (root === null) throw new Error("the counter window has no root element")
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
