import { Plus } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Toolbar } from "@/components/ui/segmented"
import { toast } from "@/lib/toast"
import { Journal as JournalList } from "@/screens/finance/journal"
import { JournalEntrySheet } from "@/screens/finance-lab-2/journal-entry"

/// The journal, and the one door that writes to it.
///
/// The LIST is the live Finance module's own screen, reused rather than
/// rewritten — one implementation of "what has been posted", so the two
/// modules cannot disagree about it. What this file adds is the act: a button
/// that opens the entry sheet over it.
///
/// The button sits above the list rather than inside it because the list is
/// somebody else's component and a screen should not reach into one to hang
/// its own control there.
export function JournalWorkspace() {
  const [writing, setWriting] = useState(false)
  return (
    <>
      <div className="px-5 pt-4">
        <Toolbar>
          <Toolbar.Spacer />
          <Button variant="primary" onClick={() => setWriting(true)}>
            <Plus className="size-4" />
            Journal entry
          </Button>
        </Toolbar>
      </div>
      <JournalList />
      <JournalEntrySheet
        open={writing}
        onClose={() => setWriting(false)}
        onPosted={(number) =>
          toast.success(`${number} posted`)
        }
      />
    </>
  )
}
