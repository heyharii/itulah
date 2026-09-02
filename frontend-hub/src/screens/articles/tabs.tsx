import { useNavigate } from "@tanstack/react-router"

import { SubTabs } from "@/components/ui/sub-tabs"

/// The three surfaces of Articles, in the order a product comes into being.
///
/// **Articles → Setups → Colours.** The catalogue as it stands; the deliveries
/// waiting to be told what they are, which is where a new article is minted;
/// and the colour vocabulary both of them draw on. One subject read three ways
/// rather than three places, which is why they are tabs and not a sidebar.
const TABS = [
  { value: "/articles", label: "Articles" },
  { value: "/articles/setups", label: "Setups" },
  { value: "/articles/colours", label: "Colours" },
] as const

/// Tabs that navigate, rather than tabs that switch a variable. Each surface
/// keeps its own route, so a link to a colour still opens on that colour and
/// the back button still means what it says.
export function ArticlesTabs({ current }: { current: string }) {
  const navigate = useNavigate()

  return (
    <SubTabs
      className="[scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      tabs={TABS}
      value={current}
      onChange={(path) => {
        if (path === current) return
        // The search string is dropped on purpose: every key in it names a
        // record on the screen being left.
        void navigate({ to: path, search: {} })
      }}
    />
  )
}
