/** Plain YYYY-MM-DD keys, used wherever a day is an identity rather than a time. */
export type DayKey = string

export const dayKey = (date: Date) => {
  const d = new Date(date)
  d.setHours(12, 0, 0, 0)
  return d.toISOString().slice(0, 10)
}

export const todayKey = () => dayKey(new Date())

export const addDays = (key: DayKey, by: number): DayKey => {
  const d = new Date(`${key}T12:00:00`)
  d.setDate(d.getDate() + by)
  return dayKey(d)
}

/** How many whole days ago a key was; negative means it is still to come. */
export const daysAgo = (key: DayKey) =>
  Math.round((new Date().setHours(12, 0, 0, 0) - new Date(`${key}T12:00:00`).getTime()) / 86_400_000)

export const shortDate = (key: DayKey) =>
  new Date(`${key}T12:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "2-digit",
  })

/** A stable 0–999 number for a string, so generated data never shifts. */
export const noise = (seed: string) => {
  let hash = 2166136261
  for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return (hash >>> 0) % 1000
}
