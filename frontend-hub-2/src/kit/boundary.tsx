import { Component, type ErrorInfo, type ReactNode } from "react"

import { ApiError } from "@/lib/api"
import { Button } from "@/kit/button"

/// What a screen does when it throws.
///
/// Without one of these, a single bad render takes the whole app to a white
/// page — the shell, the navigation and every other screen with it — and the
/// only way back is a reload. That is the wrong blast radius: one screen is
/// broken, so one screen should be broken.
///
/// So the boundary sits INSIDE the shell, around the outlet. The rail and the
/// sidebar keep working, which means the way out of a broken screen is the same
/// way you would leave a working one.
///
/// ## Why a class
///
/// React has no hook for this. `componentDidCatch` is the only way to catch a
/// render error, and it exists on class components only — this is the one place
/// in the app where that is not a style choice.
///
/// ## What it does NOT catch
///
/// An error thrown inside an event handler or a promise. Those never reach a
/// boundary; a failed query is handled by the screen showing its own error
/// state, which is better anyway — it can say *which* request failed and offer
/// the retry.
export class Boundary extends Component<
  { children: ReactNode; onReset?: () => void },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Logged, not swallowed. A boundary that renders a tidy message and tells
    // nobody what happened is a boundary that hides the bug it caught.
    console.error("Screen failed to render", error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    // A refusal from the server is not a bug in this screen, and saying "an
    // error occurred" to somebody who is simply not allowed to see a page
    // sends them to look for a fault that is not there.
    const refused = error instanceof ApiError && error.status === 403

    return (
      <div className="grid flex-1 place-items-center p-10">
        <div className="flex max-w-[42ch] flex-col items-start gap-3">
          <h2 className="text-metric m-0 font-semibold">
            {refused ? "You cannot open this screen" : "This screen stopped"}
          </h2>
          <p className="text-ctl text-ink-3 m-0">
            {refused
              ? error.detail ||
                "Your account does not reach this part of Finance. Everything else on the left still works."
              : "Something in it threw while drawing. The rest of the app is unaffected — the navigation on the left still works."}
          </p>
          {!refused && (
            <pre className="rounded-ctl bg-wash text-label text-ink-3 max-w-full overflow-x-auto px-3 py-2 font-mono">
              {error.message}
            </pre>
          )}
          <Button
            onClick={() => {
              this.setState({ error: null })
              this.props.onReset?.()
            }}
          >
            Try again
          </Button>
        </div>
      </div>
    )
  }
}
