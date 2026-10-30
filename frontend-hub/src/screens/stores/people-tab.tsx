import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Status } from "@/components/ui/pill"
import { RefreshStrip } from "@/components/ui/refresh-stamp"
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { Banner, EmptyState } from "@/components/ui/states"
import { ago, moment } from "@/lib/format"
import { fingerLabel } from "@/lib/queries/people"
import {
  approveAllFingers,
  approveFinger,
  posName,
  refuseFinger,
  storeFingers,
  storesKeys,
  type StoreFingerPerson,
  type StoreFingers,
  type StoreFingerWaiting,
  type StoreSummary,
} from "@/lib/queries/stores"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { OpenRow } from "@/screens/assets/asset-sections"
import { PersonSheet } from "@/screens/stores/person-sheet"
import { Section } from "@/screens/stores/shared"
import { StopDialog } from "@/screens/stores/stop-dialog"
import { saying } from "@/screens/system/units"

/// The store's People tab (owner, 2026-10-24: `store-opening-prototype.html`):
/// the fingers recorded at the store's POS, waiting for head office, and the
/// team that signs in there.
///
/// The store head records her own finger after signing in with her password,
/// and the team's after her, and recording one is her approval (owner, 24 Oct
/// 2026 for the team, 25 Oct for her own): it arrives approved under her name
/// and is the person's at once — at every POS of the store, and for
/// attendance — and an Admin can withdraw it from the person's Fingerprints.
/// What waits here is a finger from a store server that predates that, which
/// an Admin approves or refuses; refusing says why at the POS, beside the
/// finger. The card is there only while something waits; the team is under it,
/// each row saying whether the person is on a shift, stopped or last active,
/// and opening their sheet (`?person=`, `person-sheet.tsx`).
export function PeopleTab({ store }: { store: StoreSummary }) {
  const unit = store.unit_id
  const fingers = useQuery({
    queryKey: storesKeys.fingers(unit),
    queryFn: ({ signal }) => storeFingers(unit, signal),
    refetchInterval: 10_000,
  })

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <RefreshStrip queries={[fingers]} />
      {queryState(fingers, {
        loading: "Reading the team…",
        render: (data) => <PeoplePage store={store} data={data} />,
      })}
    </div>
  )
}

function PeoplePage({
  store,
  data,
}: {
  store: StoreSummary
  data: StoreFingers
}) {
  const client = useQueryClient()
  const unit = store.unit_id
  const person = useSheet("person")
  // The refusal is asked in a dialog; the question and whether it is open are
  // kept apart so its words stay while it fades out. A new `asked` is a fresh
  // dialog with a clean write.
  const [refusing, setRefusing] = useState<StoreFingerWaiting | null>(null)
  const [open, setOpen] = useState(false)
  const [asked, setAsked] = useState(0)

  // A removed store takes no more fingers; nothing is decided from here.
  const canDecide = data.can_decide && store.status !== "CLOSED"

  // Each answer is the tab as it stands after; the store's own counts (the
  // blue number in the menu, the red one on the tab) are read again.
  const settle = (answer: StoreFingers) => {
    client.setQueryData(storesKeys.fingers(unit), answer)
    void client.invalidateQueries({ queryKey: storesKeys.detail(unit) })
    void client.invalidateQueries({ queryKey: storesKeys.list() })
  }
  const approve = useMutation({
    mutationFn: (finger: StoreFingerWaiting) =>
      approveFinger(unit, finger.submission_id),
    onSuccess: settle,
  })
  const approveAll = useMutation({
    mutationFn: () => approveAllFingers(unit),
    onSuccess: settle,
  })

  const waiting = data.waiting

  return (
    <>
      {(approve.isError || approveAll.isError) && (
        <Banner tone="bad">{saying(approve.error ?? approveAll.error)}</Banner>
      )}

      {waiting.length > 0 && (
        <Section
          title={
            <>
              Fingers waiting{" "}
              <span className="font-normal text-mute tabular-nums">
                {waiting.length}
              </span>
            </>
          }
          actions={
            canDecide && waiting.length > 1 ? (
              <Button
                variant="primary"
                size="sm"
                pending={approveAll.isPending}
                onClick={() => approveAll.mutate()}
              >
                {approveAll.isPending ? "Approving…" : "Approve all"}
              </Button>
            ) : undefined
          }
        >
          <Card className="overflow-clip px-4 pt-3.5 pb-1">
            <MiniTable
              head={[
                { label: "Person", align: "left" },
                { label: "Finger", align: "left" },
                { label: "Recorded", align: "left" },
                { label: "", align: "right" },
              ]}
            >
              {waiting.map((finger) => (
                <MiniRow key={finger.submission_id}>
                  <MiniCell className="font-medium text-ink">
                    {finger.name}
                  </MiniCell>
                  <MiniCell>
                    {fingerLabel(finger.finger)}
                    {finger.replaces && (
                      <span className="block text-mute">
                        Replaces the enrolled one
                      </span>
                    )}
                  </MiniCell>
                  <MiniCell>
                    {finger.recorded_by}
                    <span className="block text-mute">
                      {moment(finger.recorded_at)}
                    </span>
                  </MiniCell>
                  <MiniCell align="right" className="whitespace-nowrap">
                    {canDecide && (
                      <span className="inline-flex gap-1.5">
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={approveAll.isPending}
                          onClick={() => {
                            setRefusing(finger)
                            setAsked((count) => count + 1)
                            setOpen(true)
                          }}
                        >
                          Refuse
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          pending={
                            approve.isPending &&
                            approve.variables?.submission_id ===
                              finger.submission_id
                          }
                          disabled={approveAll.isPending}
                          onClick={() => approve.mutate(finger)}
                        >
                          Approve
                        </Button>
                      </span>
                    )}
                  </MiniCell>
                </MiniRow>
              ))}
            </MiniTable>
          </Card>
        </Section>
      )}

      <Section title="Team">
        <Card className="overflow-clip px-4 pt-3.5 pb-1">
          {data.people.length === 0 ? (
            <EmptyState>Nobody signs in at this store yet</EmptyState>
          ) : (
            <MiniTable
              head={[
                { label: "Name", align: "left" },
                { label: "Role", align: "left" },
                { label: "Fingers", align: "left" },
                { label: "Now", align: "left" },
                { label: "", align: "right" },
              ]}
            >
              {data.people.map((one) => (
                <PersonRow
                  key={one.user_id}
                  person={one}
                  onOpen={() => person.open(one.user_id)}
                />
              ))}
            </MiniTable>
          )}
        </Card>
      </Section>

      <PersonSheet store={store} people={data.people} />

      {refusing !== null && (
        <RefuseDialog
          key={asked}
          finger={refusing}
          unit={unit}
          open={open}
          onOpenChange={setOpen}
          onDone={settle}
        />
      )}
    </>
  )
}

/// One person of the team. The row opens their sheet; what it says is where
/// they are now — on a shift at a POS, stopped by head office, or when they
/// last worked here.
function PersonRow({
  person,
  onOpen,
}: {
  person: StoreFingerPerson
  onOpen: () => void
}) {
  const fingers = person.fingers.length
  return (
    <OpenRow onOpen={onOpen}>
      <MiniCell className="font-medium text-ink">{person.name}</MiniCell>
      <MiniCell>{person.role}</MiniCell>
      <MiniCell className={fingers === 0 ? "text-mute" : undefined}>
        <span title={person.fingers.map(fingerLabel).join(", ") || undefined}>
          {fingers === 0
            ? "No finger yet"
            : `${fingers} ${fingers === 1 ? "finger" : "fingers"}`}
        </span>
      </MiniCell>
      <MiniCell>
        <PersonState person={person} />
      </MiniCell>
      <MiniCell align="right" className="whitespace-nowrap">
        {person.waiting > 0 && (
          <Status tone="warn">{person.waiting} waiting</Status>
        )}
      </MiniCell>
    </OpenRow>
  )
}

/// A stopped person says so, red, with the drawer they still have open under
/// it; one on a shift says where, green; the rest say when they last worked.
function PersonState({ person }: { person: StoreFingerPerson }) {
  const shift =
    person.on_shift === null ? null : `On shift · ${posName(person.on_shift)}`
  if (person.stopped)
    return (
      <>
        <Status tone="bad">Stopped</Status>
        {shift !== null && <span className="block text-mute">{shift}</span>}
      </>
    )
  if (shift !== null)
    return (
      <Status tone="ok" className="text-ok-fg">
        {shift}
      </Status>
    )
  return (
    <span className="text-mute">
      {person.last_active_at === null
        ? "Not active yet"
        : `Last active ${ago(person.last_active_at)}`}
    </span>
  )
}

/// Refuse one finger: the question is asked once, with the reason the POS will
/// show beside it — optional, because the person at the store can see the
/// finger is gone and ask.
function RefuseDialog({
  finger,
  unit,
  open,
  onOpenChange,
  onDone,
}: {
  finger: StoreFingerWaiting
  unit: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: (answer: StoreFingers) => void
}) {
  const refuse = useMutation({
    mutationFn: (reason: string) =>
      refuseFinger(unit, finger.submission_id, reason === "" ? {} : { reason }),
    onSuccess: (answer) => {
      onDone(answer)
      onOpenChange(false)
    },
  })
  return (
    <StopDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Refuse ${finger.name}’s ${fingerLabel(finger.finger).toLowerCase()}?`}
      facts={[
        { term: "Person", value: finger.name },
        { term: "Finger", value: fingerLabel(finger.finger) },
        {
          term: "Recorded",
          value: `${finger.recorded_by} · ${moment(finger.recorded_at)}`,
        },
      ]}
      reasonOptional
      action="Refuse"
      pending={refuse.isPending}
      error={refuse.error}
      onConfirm={(reason) => refuse.mutate(reason)}
    />
  )
}
