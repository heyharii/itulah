import { createContext, use } from "react"

/// How much room the cards under an answer have.
///
/// The renderers in `artifact.tsx` were written for one place — a 30rem panel
/// over somebody's work — and every cap in them says so: twelve rows, three
/// columns, no scrolling. Those caps are right there and wrong on the
/// assistant's own page, which is 46rem wide and the whole screen, where
/// "twelve of a hundred and twelve pools" is a table that quietly answers a
/// different question from the one asked.
///
/// A context and not a prop, because the thing that knows is the shell and the
/// thing that needs to know is six components down inside a renderer keyed by
/// tool name. Passing it by hand would mean every renderer taking a parameter
/// it does not use in order to hand it to a `<Table>`.
///
/// Two values and no measurement. Which of the two surfaces you are on is a
/// fact the shell already has; measuring the container would make the same
/// decision later, less predictably, and after a first paint at the wrong size.
export type ArtifactSpace = "panel" | "page"

export const ArtifactSpaceContext = createContext<ArtifactSpace>("panel")

export function useArtifactSpace(): ArtifactSpace {
  return use(ArtifactSpaceContext)
}

/// How many rows a card draws before it stops.
///
/// The page still has a ceiling: a card is an illustration of an answer, not
/// an export, and a reader who wants all hundred and twelve rows is a reader
/// who wants a report. It is high enough that the common cases — nineteen
/// shops, a fortnight of days, a fleet's pools — are whole.
export function rowsShown(space: ArtifactSpace): number {
  return space === "page" ? 40 : 12
}
