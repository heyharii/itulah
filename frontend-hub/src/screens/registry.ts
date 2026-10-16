/// The shape a module's screen map has.
///
/// A module exports `screens` from `src/screens/<module>/index.ts` and
/// `routes.tsx` merges them. Splitting the map per module is not
/// only tidiness: it is what lets every module be written at once without any
/// two of them editing the same file.
export type ScreenMap = Readonly<Record<string, Screen | LazyScreen>>

export type Screen = () => React.ReactNode

/// A screen fetched on its own, the first time its path is opened (or a
/// moment before, on a hover). A module's map used to import every screen it
/// had, so opening one page downloaded and ran the whole department's — 81
/// files for Master. `module` names the file (`master/articles`) so the
/// server can name its chunks in the response (`vite.screen-preloads.ts`).
export interface LazyScreen {
  readonly module: string
  readonly lazy: () => Promise<Screen>
}

export function lazyScreen<M>(
  module: string,
  load: () => Promise<M>,
  pick: (loaded: M) => Screen
): LazyScreen {
  // A chunk of a build that is gone resolves to nothing once `vite:preloadError`
  // has been handled (`boot-client.ts` reloads the page): wait for that reload
  // instead of reading a screen off `undefined` and showing the error.
  return {
    module,
    lazy: () =>
      load().then((loaded) =>
        loaded === undefined ? new Promise<Screen>(() => {}) : pick(loaded)
      ),
  }
}

/// The component behind a map entry, fetching it first when it is lazy.
export async function screenOf(entry: Screen | LazyScreen): Promise<Screen> {
  return typeof entry === "function" ? entry : entry.lazy()
}
