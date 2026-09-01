/// The shape the screen map has.
///
/// One map for the whole till rather than the console's one per module: ten
/// screens do not need nine files, and nothing here is being written by nine
/// hands at once.
export type ScreenMap = Readonly<Record<string, () => React.ReactNode>>
