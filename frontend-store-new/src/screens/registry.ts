/// The shape the screen map has.
///
/// One map for the whole till rather than the console's one per module: ten
/// screens do not need nine files, and nothing here is being written by nine
/// hands at once. A value is a LOADER, not a component: see `index.ts` for why
/// each screen is its own chunk now.
export type ScreenLoaders = Readonly<
  Record<string, () => Promise<{ default: React.ComponentType }>>
>
