/// The shape a module's screen map has.
///
/// A module exports `screens` from `src/screens/<module>/index.ts` and
/// `routes.tsx` merges them. Splitting the map per module is not
/// only tidiness: it is what lets every module be written at once without any
/// two of them editing the same file.
export type ScreenMap = Readonly<Record<string, () => React.ReactNode>>
