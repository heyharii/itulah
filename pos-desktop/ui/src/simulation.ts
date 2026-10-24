/// Simulated fingers, for a till with no scanner to press.
///
/// `VITE_SIM_FINGERS="dian,maya"` names the people whose finger a tester may
/// "place"; `VITE_SIM_PASSWORD` is what the node knows them by in that
/// environment. Both come from the dev server's environment, never from this
/// source, and a build that sets neither draws no simulated scanner at all.
/// Pressing a person stands in for the scanner matching their finger; the
/// sign-in itself is the node's, as always.

export const SIM_FINGERS: readonly string[] = (import.meta.env.VITE_SIM_FINGERS ?? "")
  .split(",")
  .map((one: string) => one.trim())
  .filter((one: string) => one !== "")

export const SIM_SECRET: string = import.meta.env.VITE_SIM_PASSWORD ?? ""

export const SIMULATED = SIM_FINGERS.length > 0 && SIM_SECRET !== ""

/// Whose finger the head's sensor stands for: `VITE_SIM_HEAD`, else the last
/// simulated person.
export const SIM_HEAD: string =
  import.meta.env.VITE_SIM_HEAD ?? SIM_FINGERS[SIM_FINGERS.length - 1] ?? ""

export const titled = (name: string) =>
  name.charAt(0).toUpperCase() + name.slice(1)
