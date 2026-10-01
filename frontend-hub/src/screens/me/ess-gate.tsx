import { Panel } from "@/screens/me/ui/bits"
import { useEssModules } from "@/screens/me/data/queries"

/// A screen of a module the company has turned off says so, rather than
/// offering a form whose answer nobody will read (0813).
export function EssGate({
  module,
  children,
}: {
  module: string
  children: React.ReactNode
}) {
  const modules = useEssModules().data?.modules
  if (modules !== undefined && !modules.includes(module)) {
    return (
      <Panel title="Not in use">
        <p className="text-meta text-body">
          Your company does not use this part of the app. Ask HR if you need it.
        </p>
      </Panel>
    )
  }
  return <>{children}</>
}
