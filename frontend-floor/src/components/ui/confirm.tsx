import { Button } from "@/components/ui/button"
import { BottomSheet } from "@/components/ui/picker-sheet"
import { asking, settle, useQuestion } from "@/lib/confirm"

/// The sheet `confirm()` (lib/confirm.ts) asks its question in. Mounted once,
/// in the shell.
export function ConfirmHost() {
  const { open, question } = useQuestion()

  return (
    <BottomSheet
      open={open}
      onOpenChange={(next) => {
        if (!next && asking()) settle(false)
      }}
      title={question?.title ?? ""}
    >
      <div className="flex flex-col gap-4 px-4 pt-1 pb-4">
        {question?.body !== undefined && (
          <p className="text-[0.9375rem] leading-relaxed text-body">
            {question.body}
          </p>
        )}
        <div className="flex flex-col gap-2">
          <Button
            variant={question?.danger === true ? "danger" : "primary"}
            size="lg"
            block
            onClick={() => settle(true)}
          >
            {question?.yes ?? "Lanjutkan"}
          </Button>
          <Button variant="soft" size="lg" block onClick={() => settle(false)}>
            {question?.no ?? "Batal"}
          </Button>
        </div>
      </div>
    </BottomSheet>
  )
}
