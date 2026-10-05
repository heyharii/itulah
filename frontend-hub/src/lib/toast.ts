/// `toast.success("Count sent · 3 lines")`.
///
/// The receipt that names what a save minted — "PO-… issued" — is a
/// `<SavedDialog>` now, not a toast; see `ui/dialog.tsx`. This helper is for
/// the confirmations that did not change the screen.
///
/// Re-exported from the kit rather than imported from `sonner` at every call
/// site, so the day this is drawn by something else no screen has to change.
/// It lives in `lib/` and not beside `<Toasts>` for a duller reason: a module
/// that exports both a component and a function loses fast refresh.
export { toast } from "sonner"
