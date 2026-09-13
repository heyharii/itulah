import type { PurchaseHistory, SupplierItem } from "@itulah/contract"

import { Tag } from "@/kit/tag"
import { Failed, Loading } from "@/kit/state"
import { amount, count, day } from "@/lib/format"
import { useReport } from "@/lib/list"

import { readinessOf, READINESS, sizeLabel, termLabel } from "@/modules/procurement/labels"
import { Fact, Facts, LinkButton, Quiet, SubHead } from "@/modules/procurement/parts"
import { useVocabulary } from "@/modules/procurement/reads"
import { keys } from "@/modules/procurement/wire"

/// What a supplier item IS, drawn once for the two screens that show one.
///
/// Sourcing and Catalogue open the same record for different reasons — one is
/// shopping, the other is master data — so they compose their own sheets, their
/// own headings and their own footers, and share only this: the photograph, the
/// facts, and the words the item is filed under.
///
/// ## It re-reads rather than taking the row
///
/// Both callers are holding a `SourcedItem` that contains the whole item, so
/// this could take it as a prop and make no request. It does not, for the
/// reason `PersonSheet` in `people/directory.tsx` gives: an id in the address
/// bar is a promise that the record opens. A link in a message, a bookmark, a
/// row that has scrolled past the loaded page — each of those names an item the
/// list is not holding, and a panel that could only draw what was already on
/// screen would answer them with a blank.
///
/// What the caller DOES hand in is `bought`, because it is the one fact the
/// record route does not carry: the sourcing search computes it and
/// `GET /supplier-items/{id}` does not. Absent means "not looked up" and never
/// "never bought" — a zero and an unknown are different answers, which is why
/// the section is silent rather than showing zeros.
export function ItemRecord({
  id,
  bought,
}: {
  id: string
  bought?: PurchaseHistory
}) {
  const vocabulary = useVocabulary()
  const record = useReport<SupplierItem>({
    key: keys.item(id),
    path: `/api/v1/supplier-items/${encodeURIComponent(id)}`,
    enabled: id !== "",
  })

  const item = record.data
  if (record.isError) {
    return (
      <Failed
        what="this item"
        error={record.error}
        onRetry={() => void record.refetch()}
      />
    )
  }
  if (item === undefined) return <Loading rows={5} cols={2} />

  const ready = READINESS[readinessOf(item)]

  return (
    <>
      {item.image_url !== null && (
        <img
          src={item.image_url}
          alt={item.name}
          className="border-line bg-field max-h-64 w-full border-b object-contain"
        />
      )}

      <Facts>
        <Fact label="Supplier's code">
          <span className="font-mono">{item.supplier_item_code}</span>
        </Fact>
        <Fact label="Unit price">
          {amount(item.unit_price_minor)} {item.currency}
        </Fact>
        <Fact label="Division">
          {item.division_code === null ? (
            <Quiet>unclassified</Quiet>
          ) : (
            termLabel(vocabulary.data?.divisions, item.division_code)
          )}
        </Fact>
        <Fact label="Offered">
          <Tag tone={item.status === "ACTIVE" ? "ok" : "neutral"}>
            {item.status === "ACTIVE" ? "Active" : "Retired"}
          </Tag>
        </Fact>
        <Fact label="Our article">
          {/* Blank is a real state and it is the one that matters: an item with
              no article code of ours can be ordered and received and can never
              be tagged, priced or sold, because a SKU is our code plus a colour
              and a size. */}
          {item.internal_article_code === null ? (
            <Quiet>not linked</Quiet>
          ) : (
            <span className="font-mono">{item.internal_article_code}</span>
          )}
        </Fact>
        <Fact label="Setup">
          <Tag tone={ready.tone}>{ready.label}</Tag>
        </Fact>
        {bought !== undefined && bought.orders > 0 && (
          <>
            {/* Only when there IS a history. "0 bought" on an item nobody has
                ordered reads as a judgement; silence reads as a first order. */}
            <Fact label="Bought">{count(bought.units)} pieces</Fact>
            <Fact label="On orders">{count(bought.orders)}</Fact>
            <Fact label="Last ordered" wide>
              {bought.last_ordered_at === null ? (
                <Quiet>every order naming it is still a draft</Quiet>
              ) : (
                day(bought.last_ordered_at)
              )}
            </Fact>
          </>
        )}
        <Fact label="Last touched" wide>
          {day(item.updated_at)} by {item.updated_by}
        </Fact>
      </Facts>

      {item.description !== null && item.description !== "" && (
        <p className="text-ctl text-ink-2 border-line border-t px-[18px] py-3">
          {item.description}
        </p>
      )}

      {/* The full lists here, where a card shows five dots and the ends of the
          size range. The sheet is where somebody goes to read, so it is the one
          place that should not abbreviate.

          Colours carry their own labels and hexes on the item, so nothing is
          looked up — that is exactly what `SupplierItemColour` exists for.
          Sizes carry codes, and the words come from the vocabulary. */}
      <SubHead>Comes in</SubHead>
      {item.colours.length === 0 && item.size_codes.length === 0 ? (
        <p className="text-ctl text-ink-4 px-[18px] py-3">
          Nobody has said what colours or sizes this is offered in. Most of a
          scraped supplier feed is exactly that, and it is not the same as
          "comes in none".
        </p>
      ) : (
        <div className="flex flex-col gap-2 px-[18px] py-3">
          {item.colours.length > 0 && (
            <span className="flex flex-wrap gap-1.5">
              {item.colours.map((colour) => (
                <span
                  key={colour.colour_code}
                  className="rounded-tag border-line-2 text-ctl text-ink-2 inline-flex h-[25px] items-center gap-1.5 border px-[9px]"
                >
                  <span
                    aria-hidden
                    className="border-line-2 size-[11px] shrink-0 rounded-full border"
                    style={
                      colour.hex_code === null
                        ? undefined
                        : { background: colour.hex_code }
                    }
                  />
                  {colour.label}
                </span>
              ))}
            </span>
          )}
          {item.size_codes.length > 0 && (
            <span className="flex flex-wrap gap-1.5">
              {item.size_codes.map((code) => (
                <Tag key={code}>{sizeLabel(vocabulary.data?.sizes, code)}</Tag>
              ))}
            </span>
          )}
        </div>
      )}

      <SubHead>Tags</SubHead>
      {item.tags.length === 0 ? (
        <p className="text-ctl text-ink-4 px-[18px] py-3">
          Nobody has said what kind of thing this is.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5 px-[18px] py-3">
          {item.tags.map((tag) => (
            <Tag key={tag}>{termLabel(vocabulary.data?.tags, tag)}</Tag>
          ))}
        </div>
      )}

      {/* No dead ends: whoever offers this is one click away, and the link
          works in the other direction from there. */}
      <div className="mt-auto px-[18px] py-3">
        <LinkButton
          to="/procurement/sourcing"
          search={{ shop: item.supplier_id }}
        >
          Everything this supplier sells
        </LinkButton>
      </div>
    </>
  )
}
