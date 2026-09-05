/// `toast.success("PO-… issued", { description: … })`.
///
/// Re-exported from the kit rather than imported from `sonner` at every call
/// site, so the day this is drawn by something else no screen has to change.
/// It lives in `lib/` and not beside `<Toasts>` for a duller reason: a module
/// that exports both a component and a function loses fast refresh.
export { toast } from "sonner"
