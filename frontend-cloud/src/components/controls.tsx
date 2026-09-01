import { useLocalStorage } from "@/hooks/use-local-storage";
import { CONTROLS_KEY } from "@/lib/constants/local-storage";
import { createContext, useContext } from "react";

interface ControlsContextType {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

export const ControlsContext = createContext<ControlsContextType | null>(null);

export function ControlsProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useLocalStorage(CONTROLS_KEY, true);

  return (
    <ControlsContext.Provider value={{ open, setOpen }}>
      <div
        // REMINDER: access the data-expanded state with tailwind via `group-data-[expanded=true]/controls:block`
        // In tailwindcss v4, we could even use `group-data-expanded/controls:block`
        // Sized, not just named. This sits between the app's `h-svh` column
        // and the shell's grid, so a bare block here breaks the chain of
        // `min-h-0` that lets the content area scroll: the inner
        // `overflow-auto` grows to fit its rows instead of scrolling them, and
        // the whole page scrolls instead — which also stops any
        // IntersectionObserver inside it from ever seeing its own bottom.
        className="group/controls flex min-h-0 flex-1 flex-col"
        data-expanded={open}
      >
        {children}
      </div>
    </ControlsContext.Provider>
  );
}

export function useControls() {
  const context = useContext(ControlsContext);

  if (!context) {
    throw new Error("useControls must be used within a ControlsProvider");
  }

  return context as ControlsContextType;
}
