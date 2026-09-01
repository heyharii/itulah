/**
 * The shell is the one component in the suite that renders *different DOM*
 * either side of a breakpoint, so "it looked fine when I resized the window"
 * is not evidence. These run the two layouts against a stubbed `matchMedia`
 * and assert the things a screenshot cannot: that the desktop markup is the
 * markup the fourteen screens used to hand-roll, character for character, and
 * that the mobile drawer is a real modal dialog which Escape, the backdrop and
 * a navigation all close — returning focus to the control that opened it.
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import {
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
} from "@tanstack/react-router"

import {
  AppShell,
  AppShellSidebar,
  SidebarTrigger,
} from "@/components/app-shell"

/** jsdom has no layout engine and no `matchMedia`; the shell only asks it one question. */
function setViewport(desktop: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: desktop,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

const COLS = "grid-cols-[240px_minmax(0,1fr)]"

function Screen() {
  return (
    <AppShell cols={COLS} label="Commercial navigation" railWidth={240}>
      <AppShellSidebar>
        <aside className="flex h-full min-h-0 flex-col overflow-hidden bg-page">
          <button type="button">Pricing</button>
        </aside>
      </AppShellSidebar>
      <main>
        <header>
          <SidebarTrigger />
          <span>Catalogue</span>
        </header>
      </main>
    </AppShell>
  )
}

/** Mounts `<Screen>` on a two-route memory router so navigation is real. */
async function mountScreen() {
  const rootRoute = createRootRoute()
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: Screen,
  })
  const otherRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/other",
    component: Screen,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, otherRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  })
  const view = render(<RouterProvider router={router} />)
  await screen.findByText("Catalogue")
  return { view, router }
}

/* jsdom implements <dialog> but not the top layer, so showModal/close are
 * stubbed to at least flip `open` — enough to assert the component drives the
 * element, which is the part this code owns. */
function stubDialog() {
  HTMLDialogElement.prototype.showModal = function showModal(
    this: HTMLDialogElement
  ) {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false
    this.dispatchEvent(new Event("close"))
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("at lg and above", () => {
  it("renders exactly the grid the screens used to hand-roll", async () => {
    setViewport(true)
    const { view } = await mountScreen()

    const grid = view.container.querySelector("div.grid") as HTMLElement
    expect(grid.className).toBe(`grid h-dvh ${COLS}`)

    /* The sidebar is a plain grid cell — not a dialog, not a portal. */
    const cell = grid.firstElementChild as HTMLElement
    expect(cell.tagName).toBe("DIV")
    expect(cell.className).toBe("h-full min-h-0")
    expect(cell.querySelector("aside")).not.toBeNull()
    expect(view.container.querySelector("dialog")).toBeNull()
  })

  it("renders no opener, so a screen's header is untouched", async () => {
    setViewport(true)
    await mountScreen()
    expect(
      screen.queryByRole("button", { name: /open commercial navigation/i })
    ).toBeNull()
  })
})

describe("below lg", () => {
  it("collapses the navigation track and moves the aside into a modal dialog", async () => {
    setViewport(false)
    stubDialog()
    const { view } = await mountScreen()

    const grid = view.container.querySelector("div.grid") as HTMLElement
    expect(grid.className).toBe("grid h-dvh grid-cols-[minmax(0,1fr)]")

    const dialog = view.container.querySelector("dialog") as HTMLDialogElement
    expect(dialog).not.toBeNull()
    expect(dialog.getAttribute("aria-label")).toBe("Commercial navigation")
    expect(dialog.querySelector("aside")).not.toBeNull()
    expect(dialog.open).toBe(false)
  })

  it("opens on the trigger and closes on Escape, returning focus to the trigger", async () => {
    setViewport(false)
    stubDialog()
    const { view } = await mountScreen()

    const trigger = screen.getByRole("button", {
      name: /open commercial navigation/i,
    })
    const dialog = view.container.querySelector("dialog") as HTMLDialogElement

    expect(trigger.getAttribute("aria-expanded")).toBe("false")
    fireEvent.click(trigger)
    expect(dialog.open).toBe(true)
    expect(trigger.getAttribute("aria-expanded")).toBe("true")

    /* `cancel` is what Escape fires on a modal dialog. */
    fireEvent(dialog, new Event("cancel", { cancelable: true }))
    expect(dialog.open).toBe(false)
    expect(document.activeElement).toBe(trigger)
  })

  it("closes when the backdrop — the dialog box itself — is clicked", async () => {
    setViewport(false)
    stubDialog()
    const { view } = await mountScreen()

    const trigger = screen.getByRole("button", {
      name: /open commercial navigation/i,
    })
    const dialog = view.container.querySelector("dialog") as HTMLDialogElement

    fireEvent.click(trigger)
    expect(dialog.open).toBe(true)

    /* A click inside the panel must not close it. */
    fireEvent.click(screen.getByRole("button", { name: "Pricing" }))
    expect(dialog.open).toBe(true)

    fireEvent.click(dialog)
    expect(dialog.open).toBe(false)
  })

  it("closes when the route changes", async () => {
    setViewport(false)
    stubDialog()
    const { view, router } = await mountScreen()

    const trigger = screen.getByRole("button", {
      name: /open commercial navigation/i,
    })
    fireEvent.click(trigger)
    expect(
      (view.container.querySelector("dialog") as HTMLDialogElement).open
    ).toBe(true)

    /* Straight at the history, because `router.navigate` is typed against the
     * app's registered route tree rather than this test's two-route one. */
    router.history.push("/other")
    await screen.findByText("Catalogue")
    expect(
      (view.container.querySelector("dialog") as HTMLDialogElement).open
    ).toBe(false)
  })
})
