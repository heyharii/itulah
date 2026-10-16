import { StrictMode, startTransition } from "react"
import { hydrateRoot } from "react-dom/client"
import { StartClient } from "@tanstack/react-start/client"

/// The client entry: Start's own, plus a name for every hydration miss.
///
/// When the browser's first render of a section differs from the server's
/// HTML, React redraws that section in the browser and says only "error #418"
/// in a production build. The component stack it also hands over is the part
/// that says WHICH section, so it is printed with the error — a mismatch in
/// the field is then a line in the console that points at its component.
startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <StartClient />
    </StrictMode>,
    {
      onRecoverableError(error, info) {
        console.error(error, info.componentStack)
      },
    }
  )
})
