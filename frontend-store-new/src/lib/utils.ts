import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

/// The one class joiner. `twMerge` is what makes a component's own classes
/// overridable from the outside without a specificity fight.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
