import { useMutation } from "@tanstack/react-query"
import { useCallback, useState } from "react"

import { uploadAttachment } from "@/lib/queries/workplace"
import type { PendingAttachment } from "@/screens/workplace/parts"

/// Files that have been uploaded and are waiting for something to attach them
/// to.
///
/// Upload runs ahead of the send, which is the server's own design: a
/// photograph finishes while the message is still being typed, and the send
/// then names a `file_id` it already holds. So a slow attachment never blocks a
/// send — and a send that fails does not lose the upload, because the bytes are
/// already stored and the ids are still here.
///
/// Nothing is invalidated on upload: a stored file that nothing has attached
/// yet is reachable from no room, so it appears on no screen until the message
/// or the post that names it exists.
export function useAttachments() {
  const [pending, setPending] = useState<readonly PendingAttachment[]>([])
  const [problem, setProblem] = useState<string | null>(null)

  const upload = useMutation({
    mutationFn: (file: File) => uploadAttachment(file),
    onSuccess: (file) => {
      setProblem(null)
      setPending((previous) => [
        ...previous,
        {
          file_id: file.file_id,
          file_name: file.file_name,
          byte_size: file.byte_size,
        },
      ])
    },
    // The server explains a refused upload in a sentence — too big, wrong kind
    // — and that sentence is what belongs on screen, never a code.
    onError: (error: Error) => setProblem(error.message),
  })

  const remove = useCallback((fileId: string) => {
    setPending((previous) => previous.filter((file) => file.file_id !== fileId))
  }, [])

  const clear = useCallback(() => {
    setPending([])
    setProblem(null)
  }, [])

  return {
    pending,
    ids: pending.map((file) => file.file_id),
    problem,
    uploading: upload.isPending,
    add: upload.mutate,
    remove,
    clear,
  }
}
