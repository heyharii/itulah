import { APPS, type AppId } from "@/components/apps"
import { APP_ICON } from "@/components/app-icons"

/** The app's identity in its own sidebar. Switching apps lives in the rail
 * at the far left, so this is a label, not a control. */
export function AppHeading({ app }: { app: AppId }) {
  const current = APPS.find((a) => a.id === app) ?? APPS[0]

  return (
    <div className="flex h-[34px] min-w-0 flex-1 items-center gap-2 py-0 pr-2 pl-1.5">
      <img
        src={APP_ICON[current.id]}
        alt=""
        draggable={false}
        className="size-[22px] shrink-0 select-none"
      />
      <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[13.5px] font-semibold">
        {current.label}
      </span>
    </div>
  )
}
