import { useState } from "react"

import { Icon, paths } from "@/components/dashboard/parts"
import {
  KIND_META,
  OWNERS,
  countOf,
  displayName,
  extensionOf,
  formatSize,
  modifiedLabel,
  ownerLabel,
  sizeOf,
  type FileNode,
} from "@/components/files/data"
import { VirtualRows } from "@/shared/table"
import { cn } from "@/lib/utils"

const FILE_COLUMNS = "minmax(0,1fr) 168px 128px 96px 44px"

const KIND_PATH: Record<string, React.ReactNode> = {
  folder: paths.folder,
  doc: paths.doc,
  sheet: paths.sheet,
  slide: paths.slide,
  pdf: paths.pdf,
  image: paths.image,
  video: paths.video,
  archive: paths.archive,
}

/** The file's glyph, tinted by kind so the list scans by colour. */
export function FileGlyph({ node, size = 20 }: { node: FileNode; size?: number }) {
  const meta = KIND_META[node.kind]
  return (
    <span style={{ color: meta.hue }} className="shrink-0">
      <Icon path={KIND_PATH[node.kind]} size={size} width={1.7} />
    </span>
  )
}

export function OwnerAvatar({
  id,
  name,
  size = 22,
}: {
  id: string
  name?: string
  size?: number
}) {
  const owner = OWNERS[id]
  const label = owner?.name ?? name ?? (id && id !== "unknown" ? id : "Unknown uploader")
  const hue = owner?.hue ?? "#7e7e7d"
  return (
    <span
      title={label}
      style={{ background: hue, width: size, height: size, fontSize: size * 0.42 }}
      className="grid shrink-0 place-items-center rounded-full font-semibold text-white uppercase select-none"
    >
      {label[0]}
    </span>
  )
}

function Check({ checked, label, onChange }: { checked: boolean; label: string; onChange: () => void }) {
  return (
    <label
      title={label}
      onClick={(e) => e.stopPropagation()}
      className="group/check relative inline-flex size-[22px] shrink-0 items-center justify-center"
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        aria-label={label}
        className="absolute size-px opacity-0"
      />
      <span
        className={cn(
          "inline-flex size-[17px] items-center justify-center rounded-[5px] border bg-surface transition-[border-color,background-color,transform] duration-[140ms] ease-spring",
          "group-hover/check:border-ink-4 group-active/check:scale-[0.94]",
          checked ? "border-accent bg-accent text-white" : "border-line-strong text-transparent"
        )}
      >
        {checked && <Icon path={paths.check} size={10} width={3.2} />}
      </span>
    </label>
  )
}

interface ViewProps {
  nodes: FileNode[]
  all: FileNode[]
  selected: Set<string>
  onToggle: (id: string) => void
  onToggleAll: () => void
  onOpen: (node: FileNode) => void
  onDetails: (node: FileNode) => void
  /** Undefined for live Internal rows because no star/unstar route exists. */
  onStar?: (id: string) => void
}

export function FileTable({
  nodes,
  all,
  selected,
  onToggle,
  onToggleAll,
  onOpen,
  onDetails,
  onStar,
}: ViewProps) {
  const allOn = nodes.length > 0 && nodes.every((n) => selected.has(n.id))

  /* Only a double-click opens a file — VirtualRows' `onRowClick` fires on a
   * single click and would also paint the whole row with its own hover +
   * pointer-cursor styling, which this list never had (its rows are
   * `cursor-default`). So the row's own hover highlight and its
   * open-on-double-click both live here instead, applied to every cell. */
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const rowProps = (node: FileNode) => ({
    onDoubleClick: () => onOpen(node),
    onMouseEnter: () => setHoveredId(node.id),
    onMouseLeave: () =>
      setHoveredId((current) => (current === node.id ? null : current)),
  })

  return (
    <VirtualRows
      rows={nodes}
      rowKey={(node) => node.id}
      columns={FILE_COLUMNS}
      rowHeight={42}
      header={
        <>
          <span className="flex items-center gap-2.5 pr-3 pl-3.5 text-left">
            <Check checked={allOn} label="Select all" onChange={onToggleAll} />
            Name
          </span>
          <span className="px-3 text-left">Owner</span>
          <span className="px-3 text-right">Modified</span>
          <span className="px-3 text-right">Size</span>
          <span />
        </>
      }
      renderRow={(node) => {
        const on = selected.has(node.id)
        const hovered = hoveredId === node.id
        const cellBg = cn(
          "transition-colors duration-[120ms]",
          on
            ? "bg-[color-mix(in_srgb,var(--accent)_7%,var(--surface))]"
            : hovered && "bg-hover"
        )
        return (
          <>
            <span
              role="gridcell"
              {...rowProps(node)}
              className={cn("self-stretch pr-3 pl-3.5", cellBg)}
            >
              <span className="flex h-full items-center gap-2.5">
                <Check checked={on} label={`Select ${node.name}`} onChange={() => onToggle(node.id)} />
                <FileGlyph node={node} />
                <button
                  type="button"
                  onClick={() => onOpen(node)}
                  className="min-w-0 flex-1 overflow-hidden text-left text-ellipsis whitespace-nowrap font-medium text-ink hover:underline hover:decoration-[color-mix(in_srgb,currentColor_35%,transparent)] hover:underline-offset-[3px]"
                >
                  {displayName(node)}
                </button>
                {node.sharedWith?.length ? (
                  <Icon
                    path={paths.people}
                    size={13}
                    width={1.9}
                    className="shrink-0 text-ink-4"
                  />
                ) : null}
              </span>
            </span>

            <span role="gridcell" {...rowProps(node)} className={cn("self-stretch px-3", cellBg)}>
              <span className="flex h-full items-center gap-2">
                <OwnerAvatar id={node.ownerId} name={node.ownerName} size={20} />
                <span className="truncate text-xs text-ink-2">{ownerLabel(node)}</span>
              </span>
            </span>

            <span
              role="gridcell"
              {...rowProps(node)}
              className={cn(
                "flex items-center justify-end self-stretch px-3 font-mono text-xs text-ink-3 tabular-nums",
                cellBg
              )}
            >
              {modifiedLabel(node.modified)}
            </span>

            <span
              role="gridcell"
              {...rowProps(node)}
              className={cn(
                "flex items-center justify-end self-stretch px-3 font-mono text-xs text-ink-3 tabular-nums",
                cellBg
              )}
            >
              {node.kind === "folder"
                ? `${countOf(all, node.id)} items`
                : formatSize(sizeOf(all, node))}
            </span>

            <span role="gridcell" {...rowProps(node)} className={cn("self-stretch pr-2.5", cellBg)}>
              <span className="flex h-full items-center justify-end gap-0.5">
                {onStar && (
                  <button
                    type="button"
                    aria-label={node.starred ? "Unstar" : "Star"}
                    onClick={() => onStar(node.id)}
                    className={cn(
                      "grid size-[26px] place-items-center rounded-chip transition-colors",
                      node.starred
                        ? "text-honey"
                        : cn(
                            "text-ink-4 hover:bg-hover-2 hover:text-ink-2",
                            hovered ? "opacity-100" : "opacity-0"
                          )
                    )}
                  >
                    <Icon path={paths.star} size={14} width={1.9} />
                  </button>
                )}
                <button
                  type="button"
                  aria-label="Details"
                  onClick={() => onDetails(node)}
                  className={cn(
                    "grid size-[26px] place-items-center rounded-chip text-ink-4 transition-colors hover:bg-hover-2 hover:text-ink",
                    hovered ? "opacity-100" : "opacity-0"
                  )}
                >
                  <Icon path={paths.more} size={15} width={2} />
                </button>
              </span>
            </span>
          </>
        )
      }}
    />
  )
}

export function FileGrid({ nodes, selected, onToggle, onOpen, onDetails }: ViewProps) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(184px,1fr))] gap-2.5 p-3.5">
      {nodes.map((node) => {
        const on = selected.has(node.id)
        return (
          <div
            key={node.id}
            onDoubleClick={() => onOpen(node)}
            className={cn(
              "group/card relative flex cursor-default flex-col gap-2 rounded-panel border bg-surface p-3 transition-[border-color,background-color,box-shadow] duration-[130ms]",
              on
                ? "border-accent bg-accent-tint shadow-[0_0_0_1px_var(--accent)]"
                : "border-line-strong hover:bg-hover"
            )}
          >
            <div className="flex items-start gap-2">
              <FileGlyph node={node} size={22} />
              <button
                type="button"
                onClick={() => onOpen(node)}
                className="min-w-0 flex-1 text-left text-[13px] leading-[1.35] font-medium text-ink"
              >
                <span className="line-clamp-2">{displayName(node)}</span>
              </button>
              <span className="opacity-0 transition-opacity group-hover/card:opacity-100">
                <Check checked={on} label={`Select ${node.name}`} onChange={() => onToggle(node.id)} />
              </span>
            </div>

            {/* A flat plate tinted by kind. When the hub can stream the bytes
                and they are an image, that plate shows the real file. */}
            <div
              style={{ background: `color-mix(in srgb, ${KIND_META[node.kind].hue} 9%, var(--surface))` }}
              className="grid h-[74px] place-items-center overflow-hidden rounded-chip shadow-[inset_0_0_0_1px_var(--line)]"
            >
              {node.kind === "image" && node.contentUrl ? (
                <img
                  src={node.contentUrl}
                  alt=""
                  loading="lazy"
                  className="size-full object-cover"
                />
              ) : (
                <FileGlyph node={node} size={26} />
              )}
            </div>

            <div className="flex items-center gap-2">
              <OwnerAvatar id={node.ownerId} size={18} />
              <span className="truncate font-mono text-[10.5px] text-ink-4">
                {modifiedLabel(node.modified)}
              </span>
              <span className="ml-auto flex items-center gap-0.5">
                {node.starred && (
                  <Icon path={paths.star} size={13} width={1.9} className="text-honey" />
                )}
                <button
                  type="button"
                  aria-label="Details"
                  onClick={() => onDetails(node)}
                  className="grid size-[22px] place-items-center rounded-chip text-ink-4 opacity-0 transition-colors group-hover/card:opacity-100 hover:bg-hover-2 hover:text-ink"
                >
                  <Icon path={paths.more} size={14} width={2} />
                </button>
              </span>
            </div>

            <span className="sr-only">{extensionOf(node)}</span>
          </div>
        )
      })}
    </div>
  )
}
