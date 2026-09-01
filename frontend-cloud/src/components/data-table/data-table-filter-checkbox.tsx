"use client";

import { useDataTable } from "@/components/data-table/data-table-provider";
import { Checkbox } from "@/components/ui/checkbox";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCompactNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Search } from "lucide-react";
import { useState } from "react";
import type { DataTableCheckboxFilterField } from "./types";

export function DataTableFilterCheckbox<TData>({
  value: _value,
  options,
  component,
}: DataTableCheckboxFilterField<TData>) {
  const value = _value as string;
  const [inputValue, setInputValue] = useState("");
  const { table, columnFilters, isLoading, getFacetedUniqueValues } =
    useDataTable();
  const column = table.getColumn(value);
  // REMINDER: avoid using column?.getFilterValue()
  const filterValue = columnFilters.find((i) => i.id === value)?.value;
  const facetedValue =
    getFacetedUniqueValues?.(table, value) || column?.getFacetedUniqueValues();

  const Component = component;

  // filter out the options based on the input value
  const filterOptions = options?.filter(
    (option) =>
      inputValue === "" ||
      option.label.toLowerCase().includes(inputValue.toLowerCase()),
  );

  // CHECK: it could be filterValue or searchValue
  const filters = filterValue
    ? Array.isArray(filterValue)
      ? filterValue
      : [filterValue]
    : [];

  // REMINDER: if no options are defined, while fetching data, we should show a skeleton
  if (isLoading && !filterOptions?.length)
    return (
      <div className="border-border grid divide-y rounded-lg border">
        {Array.from({ length: 3 }).map((_, index) => (
          <div
            key={index}
            className="flex items-center justify-between gap-2 px-2 py-2.5"
          >
            <Skeleton className="h-4 w-4 rounded-sm" />
            <Skeleton className="h-4 w-full rounded-sm" />
          </div>
        ))}
      </div>
    );

  return (
    <div className="grid gap-2">
      {/* Kept for the long lists — twenty suppliers is a list you search, five
          divisions is a list you read. The threshold is raised from 4 to 8 so
          the short groups are just checkboxes, the way the language wants. */}
      {options && options.length > 8 ? (
        <InputGroup className="h-8 rounded-[var(--os-r-inner,0.5rem)] shadow-none">
          <InputGroupAddon>
            <Search className="mt-0.5 h-3.5 w-3.5" />
          </InputGroupAddon>
          <InputGroupInput
            placeholder="Search"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
          />
        </InputGroup>
      ) : null}
      {/* No box around the group: the rows are the list. A border here made
          every facet look like a card sitting inside another card. */}
      <div className="max-h-[210px] overflow-y-auto">
        {filterOptions
          // TODO: we shoudn't sort the options here, instead filterOptions should be sorted by default
          // .sort((a, b) => a.label.localeCompare(b.label))
          ?.map((option) => {
            const checked = filters.includes(option.value);

            return (
              <div
                key={String(option.value)}
                className={cn(
                  "group hover:bg-accent relative flex items-center gap-2 rounded-[var(--os-r-inner,0.5rem)] px-2 py-1.5",
                )}
              >
                <Checkbox
                  id={`${value}-${option.value}`}
                  checked={checked}
                  onCheckedChange={(checked) => {
                    const newValue = checked
                      ? [...(filters || []), option.value]
                      : filters?.filter((value) => option.value !== value);
                    column?.setFilterValue(
                      newValue?.length ? newValue : undefined,
                    );
                  }}
                  className="border-foreground! shadow-none"
                />
                <Label
                  htmlFor={`${value}-${option.value}`}
                  className="text-foreground/70 group-hover:text-accent-foreground flex w-full items-center justify-center gap-1 truncate"
                >
                  {Component ? (
                    <Component {...option} />
                  ) : (
                    <span className="truncate font-normal">{option.label}</span>
                  )}
                  {/* The count sits in the muted grey, not the text grey:
                      it measures the option, it is not part of its name. */}
                  <span className="text-muted-foreground ml-auto flex items-center justify-center font-mono text-[10.5px] tabular-nums">
                    {isLoading ? (
                      <Skeleton className="h-3.5 w-4" />
                    ) : facetedValue?.has(option.value) ? (
                      formatCompactNumber(facetedValue.get(option.value) || 0)
                    ) : null}
                  </span>
                  <button
                    type="button"
                    onClick={() => column?.setFilterValue([option.value])}
                    className={cn(
                      "text-muted-foreground hover:text-foreground absolute inset-y-0 right-0 hidden font-normal backdrop-blur-xs group-hover:block",
                      "focus-visible:border-ring focus-visible:ring-ring/50 rounded-md transition-all outline-none focus-visible:ring-[3px]",
                    )}
                  >
                    <span className="px-2">only</span>
                  </button>
                </Label>
              </div>
            );
          })}
      </div>
    </div>
  );
}
