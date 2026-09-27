import { useState } from "react"

import { Panel } from "@/components/bits"
import { Button } from "@/components/ui/button"
import { Field, Input, Select, Textarea } from "@/components/ui/field"
import { useFileGrievance, useGrievanceTypes } from "@/lib/hr/queries"

/// Speak to head office, confidentially.
///
/// The complaint is read at head office and nowhere else — not by the store
/// head, not by the store's HR. That is not a promise the interface makes; it
/// is where the server's key sits: investigating is head office's alone, so
/// the complaint about your own supervisor cannot stop at your supervisor.
export function Voice() {
  const kinds = useGrievanceTypes()
  const file = useFileGrievance()
  const [typeCode, setTypeCode] = useState("")
  const [subject, setSubject] = useState("")
  const [description, setDescription] = useState("")
  const [done, setDone] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)

  if (done) {
    return (
      <Panel title="Sent">
        <p className="text-cell text-text">
          Your complaint has reached head office. It is read there and nowhere
          else, and you will hear back through the same channel.
        </p>
      </Panel>
    )
  }

  return (
    <Panel title="Raise a concern">
      <div className="flex flex-col gap-3">
        <Field label="What is it about">
          <Select
            value={typeCode}
            onChange={(e) => setTypeCode(e.target.value)}
          >
            <option value="">Choose…</option>
            {(kinds.data ?? [])
              .filter((kind) => kind.retired_at === null)
              .map((kind) => (
                <option key={kind.code} value={kind.code}>
                  {kind.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="In one line">
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </Field>
        <Field label="What happened, when, where">
          <Textarea
            rows={5}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        {failed !== null && <p className="text-meta text-bad">{failed}</p>}
        <Button
          variant="primary"
          size="tap"
          disabled={
            typeCode === "" ||
            subject.trim() === "" ||
            description.trim() === "" ||
            file.isPending
          }
          onClick={() =>
            file.mutate(
              { type_code: typeCode, subject, description },
              {
                onSuccess: () => {
                  setDone(true)
                  setFailed(null)
                },
                onError: (error: Error) => setFailed(error.message),
              }
            )
          }
        >
          Send to HR head office
        </Button>
        <p className="text-meta text-mute">
          Only HR at head office reads this. Your store head and the store's HR
          never see what you wrote.
        </p>
      </div>
    </Panel>
  )
}
