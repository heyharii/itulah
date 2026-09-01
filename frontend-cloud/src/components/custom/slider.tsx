"use client";

import { cn } from "@/lib/utils";
import * as SliderPrimitive from "@radix-ui/react-slider";
import * as React from "react";

function Slider({
  className,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  const initialValue = Array.isArray(props.value)
    ? props.value
    : [props.min, props.max];

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn(
        "relative flex w-full touch-none items-center select-none",
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-[var(--os-soft-2,#f3f3f5)]">
        <SliderPrimitive.Range className="absolute h-full bg-[var(--os-accent,#3c52f0)]" />
      </SliderPrimitive.Track>
      {initialValue.map((_, index) => (
        <React.Fragment key={index}>
          <SliderPrimitive.Thumb className="block size-3.5 rounded-full border border-[var(--os-accent,#3c52f0)] bg-[var(--os-canvas,#fff)] shadow-[var(--os-shadow-soft,0_1px_2px_rgba(20,20,25,.03))] outline-none focus-visible:ring-2 focus-visible:ring-[var(--os-accent,#3c52f0)]/30 disabled:pointer-events-none disabled:opacity-50" />
        </React.Fragment>
      ))}
    </SliderPrimitive.Root>
  );
}

export { Slider };
