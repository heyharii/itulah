import { describe, expect, test } from "vitest"

import { whatFits } from "@/kit/table"

/// The Cash & bank column set, as it actually is — so a change to those
/// numbers has to come past these cases.
const COLUMNS = [
  { id: "account", min: 210 },
  { id: "pot", min: 130, priority: 1 },
  { id: "site", min: 110, priority: 3 },
  { id: "books", min: 170 },
  { id: "statement", min: 170, priority: 2 },
  { id: "difference", min: 150 },
]

const shown = (width: number) => {
  const hidden = whatFits(COLUMNS, width)
  return COLUMNS.filter((c) => hidden[c.id] === undefined).map((c) => c.id)
}

describe("whatFits", () => {
  test("shows everything before the container has been measured", () => {
    // Hiding on a guess would flash a narrow layout on every first paint.
    expect(whatFits(COLUMNS, 0)).toEqual({})
  })

  test("shows every column when they all fit", () => {
    // 210+130+110+170+170+150 = 940
    expect(shown(1136)).toHaveLength(6)
    expect(shown(940)).toHaveLength(6)
  })

  test("drops by priority, lowest first", () => {
    // 939 is one pixel short: `pot` (priority 1) goes and nothing else needs to.
    expect(shown(939)).toEqual([
      "account",
      "site",
      "books",
      "statement",
      "difference",
    ])
  })

  test("drops in order until it fits, not one at a time per resize", () => {
    // 564 was the real frame at a 620px viewport before the shell learned to
    // yield. pot(130) then statement(170) then site(110) leaves 530 ≤ 564.
    expect(shown(564)).toEqual(["account", "books", "difference"])
  })

  test("never drops a column that declares no priority", () => {
    // Even at a width nothing fits in. A list that hides which account a
    // figure belongs to has stopped being the list somebody asked for — so it
    // truncates visibly rather than lying quietly.
    expect(shown(100)).toEqual(["account", "books", "difference"])
  })

  test("stops as soon as the remainder fits, keeping what it can", () => {
    // 800 needs one drop, not two: 940 - 130 = 810 is still over, so
    // statement goes too and 640 ≤ 800. site survives.
    expect(shown(800)).toContain("site")
    expect(shown(800)).not.toContain("pot")
  })
})
