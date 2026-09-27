import {
  Boxes,
  ClipboardCheck,
  ListChecks,
  Send,
  Tags,
  Truck,
  type LucideIcon,
} from "lucide-react"

import { CardList, Screen, Section } from "@/components/ui/screen"
import { Banner, LoadingState } from "@/components/ui/states"
import { count } from "@/lib/format"
import { useGo } from "@/lib/go"
import {
  partialCount,
  refusedCount,
  unsentCount,
  useOutbox,
} from "@/lib/outbox"
import { useIdentity } from "@/lib/session"
import { useWaiting } from "@/lib/waiting"

/// The work list — the only screen that answers "what should I be doing".
///
/// Six stations, in the order goods move through the building: received, tagged,
/// picked, packed, sent, plus the stock take that runs across all of them.
/// Somebody who has never used the app can read this list top to bottom and have
/// described the warehouse.
///
/// **The numbers are counts, not tones.** On a floor the question is always "how
/// many are waiting for me", and a station with nothing waiting should look
/// finished rather than merely quiet — so a zero is drawn as a grey dash and
/// nothing here is amber for being busy.
///
/// **A station's number is everything queued at it**, not its headline queue.
/// Receiving that said "Kosong" while six counts sat waiting for a second person
/// would be a work list somebody stops reading by Wednesday.
export function Tugas() {
  const go = useGo()
  const waiting = useWaiting()
  const queue = useOutbox()
  const person = useIdentity().data ?? null

  const unsent = unsentCount(queue)
  const refused = refusedCount(queue)
  const partial = partialCount(queue)

  return (
    <Screen>
      <div className="pt-1 pb-4">
        <h2 className="text-title font-semibold text-ink">
          {person?.display_name ?? "Selamat bekerja"}
        </h2>
        <p className="mt-0.5 text-meta text-body">
          Yang menunggu di gudang ini sekarang.
        </p>
      </div>

      {waiting.offline && (
        <Banner tone="warn" className="mb-4">
          Node gudang tidak terhubung. Apa pun yang Anda simpan tetap tersimpan
          di HP ini dan terkirim sendiri begitu jaringan kembali.
        </Banner>
      )}
      {refused > 0 && (
        <Banner
          tone="bad"
          className="mb-4"
          action={<Open onClick={() => go("/node/antrean")} />}
        >
          {count(refused)} pekerjaan ditolak node dan perlu diperiksa orang.
        </Banner>
      )}
      {partial > 0 && (
        <Banner
          tone="warn"
          className="mb-4"
          action={<Open onClick={() => go("/node/antrean")} />}
        >
          {count(partial)} pekerjaan hanya dikerjakan sebagian oleh node.
        </Banner>
      )}
      {refused === 0 && unsent > 0 && (
        <Banner
          tone="warn"
          className="mb-4"
          action={<Open onClick={() => go("/node/antrean")} />}
        >
          {count(unsent)} pekerjaan tersimpan di HP ini, menunggu terkirim.
        </Banner>
      )}

      {/* Three states, and the third is why this is not a ternary on `known`
          alone: with the node unreachable and nothing cached there is nothing to
          count and nothing being waited for, so a "Menanyakan node…" under the
          banner that just said the node is unreachable would be the app arguing
          with itself. Stations drawn as six zeroes would be worse — that is a
          claim about the warehouse, and we do not have one. */}
      {waiting.known ? (
        <Section title="Stasiun">
          <CardList>
            <Station
              icon={Truck}
              label="Terima"
              value={waiting.owed + waiting.toVerify}
              parts={[
                waiting.owed > 0
                  ? `${count(waiting.owed)} order menunggu bongkar`
                  : null,
                waiting.toVerify > 0
                  ? `${count(waiting.toVerify)} hitungan menunggu diperiksa`
                  : null,
              ]}
              onPress={() => go("/terima")}
            />
            <Station
              icon={Tags}
              label="Tag"
              value={waiting.tagging}
              parts={[
                waiting.tagging > 0
                  ? `${count(waiting.tagging)} kerjaan belum dikonfirmasi`
                  : null,
              ]}
              onPress={() => go("/tag")}
            />
            <Station
              icon={ListChecks}
              label="Ambil"
              value={waiting.pickLines}
              parts={[
                waiting.pickLines > 0
                  ? `${count(waiting.pickLines)} SKU masih diminta toko`
                  : null,
                waiting.pickUnits > 0
                  ? `${count(waiting.pickUnits)} potong`
                  : null,
              ]}
              onPress={() => go("/ambil")}
            />
            <Station
              icon={Boxes}
              label="Kemas"
              value={waiting.shops + waiting.openBoxes}
              parts={[
                waiting.shops > 0
                  ? `${count(waiting.shops)} toko siap dikemas`
                  : null,
                waiting.openBoxes > 0
                  ? `${count(waiting.openBoxes)} koli masih terbuka`
                  : null,
              ]}
              onPress={() => go("/kemas")}
            />
            <Station
              icon={Send}
              label="Kirim"
              value={waiting.looseBoxes + waiting.unshipped + waiting.onYard}
              parts={[
                waiting.looseBoxes > 0
                  ? `${count(waiting.looseBoxes)} koli tersegel belum masuk kiriman`
                  : null,
                waiting.unshipped + waiting.onYard > 0
                  ? `${count(waiting.unshipped)} kiriman tanpa truk · ${count(waiting.onYard)} truk di halaman`
                  : null,
              ]}
              onPress={() => go("/kirim")}
            />
            <Station
              icon={ClipboardCheck}
              label="Opname"
              value={waiting.counts}
              parts={[
                waiting.counts > 0
                  ? `${count(waiting.counts)} opname sedang berjalan`
                  : null,
              ]}
              onPress={() => go("/opname")}
            />
          </CardList>
        </Section>
      ) : waiting.offline ? null : (
        <LoadingState>Menanyakan node…</LoadingState>
      )}
    </Screen>
  )
}

/// One station. The whole card is the target — 44px is a floor, not a ceiling,
/// and a card that opens a station should be tappable anywhere on it.
function Station({
  icon: Icon,
  label,
  value,
  parts,
  onPress,
}: {
  icon: LucideIcon
  label: string
  value: number
  /// What the number is made of, most important first. Nulls are dropped, so a
  /// station writes one line per kind of queue it has and says nothing about the
  /// ones that are empty.
  parts: readonly (string | null)[]
  onPress: () => void
}) {
  const said = parts.filter((part): part is string => part !== null)
  const idle = value === 0

  return (
    <button
      type="button"
      onClick={onPress}
      className="pressable flex w-full items-center gap-3 rounded-card border border-hairline bg-canvas px-3.5 py-3 text-left shadow-soft"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-inner bg-soft-2 text-line-ico [&_svg]:size-[1.125rem]">
        <Icon strokeWidth={1.7} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-card-title font-semibold text-ink">{label}</span>
        </span>
        {said.length === 0 ? (
          <span className="mt-0.5 block truncate text-meta text-mute">
            tidak ada yang menunggu
          </span>
        ) : (
          said.map((line, index) => (
            <span
              key={line}
              className={
                index === 0
                  ? "mt-0.5 block truncate text-meta text-body"
                  : "mt-0.5 block truncate text-meta text-mute"
              }
            >
              {line}
            </span>
          ))
        )}
      </span>
      {/* Empty once, not three times: the line above already says so, and a
          "Kosong" pill beside the name plus a dash here was the same fact
          drawn in three places. The dash stays, faint, to hold the column. */}
      <span
        className={
          idle
            ? "text-metric font-semibold text-faint tabular-nums"
            : "text-metric font-semibold text-ink tabular-nums"
        }
      >
        {idle ? "—" : count(value)}
      </span>
    </button>
  )
}

/// The one-word link a banner carries. Written here rather than inline three
/// times so the three banners cannot drift into three different words.
function Open({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 underline underline-offset-2"
    >
      Buka
    </button>
  )
}
