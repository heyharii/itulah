import { Outbox } from "@/components/outbox"
import { Note, ScreenBody, ScreenHeader } from "@/components/shell"

/// The outbox, given a screen of its own as well as a light in the header.
///
/// An Edge is built to keep working when the line is down, so a site can trade
/// all day with nothing leaving the building and no symptom anybody would
/// notice. This is the one number worth checking at the end of a shift.
export function OutboxScreen() {
  return (
    <>
      <ScreenHeader
        title="Outbox"
        subtitle="What this node has written and not yet sent"
      />
      <ScreenBody>
        <Outbox className="max-w-lg" />
        <Note>
          Asking for a send does not shorten a cooldown. A button that appeared
          to force one during an outage would only hide the outage.
        </Note>
      </ScreenBody>
    </>
  )
}
