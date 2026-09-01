import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { listSuppliers } from "@/lib/sourcing"
import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"

/// Starting an order by naming its supplier.
///
/// The draft screen has never needed the basket — it reads the supplier's
/// whole catalogue and has its own search — but until this existed the only
/// route to it ran through Sourcing and the basket, so raising an order for
/// one known thing meant picking that thing out first. A buyer who already
/// knows who they are ordering from should not have to shop for it.
///
/// The basket still seeds the draft when it holds lines for the supplier
/// chosen here. That is the same draft either way: one screen, two ways in,
/// rather than a second order form that would drift from the first.
export function SupplierPicker({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
  // Active only. An order raised against a deactivated supplier is a question
  // for whoever deactivated them, not a thing to make easy.
  const suppliers = useQuery({
    queryKey: ["suppliers", "ACTIVE"],
    queryFn: ({ signal }) => listSuppliers("ACTIVE", signal),
    enabled: open,
  })

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Choose a supplier"
      description="The order goes to one supplier. Pick who is being ordered from."
    >
      <CommandInput placeholder="Search suppliers by name or code…" />
      <CommandList>
        <CommandEmpty>
          {suppliers.isPending
            ? "Loading suppliers…"
            : suppliers.isError
              ? "The supplier list could not be loaded."
              : "No supplier matches that."}
        </CommandEmpty>
        <CommandGroup heading="Suppliers">
          {(suppliers.data ?? []).map((supplier) => (
            <CommandItem
              key={supplier.supplier_id}
              // Both are searchable: buyers say "SUP02" as readily as the name.
              value={`${supplier.name} ${supplier.supplier_code}`}
              onSelect={() => {
                onOpenChange(false)
                void navigate({
                  to: "/orders/new/$supplierId",
                  params: { supplierId: supplier.supplier_id },
                })
              }}
            >
              <span className="truncate">{supplier.name}</span>
              <span className="text-muted-foreground ml-auto font-mono text-[11px]">
                {supplier.supplier_code}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
