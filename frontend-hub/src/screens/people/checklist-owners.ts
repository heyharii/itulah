/// Who ticks a checklist task, as the screens name them.
export const OWNER_LABEL: Record<string, string> = {
  HEAD_OFFICE: "Head office",
  STORE: "Store",
  IT: "IT",
  EMPLOYEE: "Employee",
}

export const OWNER_CHOICES = Object.entries(OWNER_LABEL).map(
  ([value, label]) => ({ value, label })
)
