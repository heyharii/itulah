"use client";

import { useDataTable } from "@/components/data-table/data-table-provider";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useHotKey } from "@/hooks/use-hot-key";
import { X } from "lucide-react";

export function DataTableResetButton() {
  const { table } = useDataTable();
  useHotKey(table.resetColumnFilters, "Escape");

  return (
    <TooltipProvider delay={100}>
      <Tooltip>
        <TooltipTrigger render={<Button variant="ghost" onClick={() => table.resetColumnFilters()} />}><X className="mr-2 h-4 w-4" />Reset
                        </TooltipTrigger>
        <TooltipContent side="left">
          <p className="text-nowrap">
            Reset filters with{" "}
            <Kbd className="text-muted-foreground group-hover:text-accent-foreground ml-1">
              <span className="mr-1">⌘</span>
              <span>Esc</span>
            </Kbd>
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
