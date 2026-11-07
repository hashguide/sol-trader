"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import { cn } from "@/lib/format";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass",
  {
    variants: {
      variant: {
        default: "bg-brass text-ink hover:bg-brass/90",
        quiet: "border border-line bg-panel-2 text-paper hover:bg-line/40",
        danger: "bg-rose text-ink hover:bg-rose/90",
        ghost: "text-fog hover:bg-panel-2 hover:text-paper",
      },
      size: {
        default: "h-9 px-3",
        sm: "h-8 px-2.5 text-xs",
        lg: "h-11 px-4",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export function Button({ className, variant, size, asChild = false, ...props }: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn("h-9 w-full rounded-md border border-line bg-ink px-3 text-sm text-paper outline-none placeholder:text-fog/70 focus:border-brass", className)}
      {...props}
    />
  );
}

export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return <label className={cn("text-xs uppercase tracking-wide text-fog", className)} {...props} />;
}

export function Badge({ className, tone = "neutral", ...props }: React.ComponentProps<"span"> & { tone?: "neutral" | "good" | "bad" | "warn" | "live" }) {
  const tones = {
    neutral: "border-line text-fog",
    good: "border-mint/40 text-mint",
    bad: "border-rose/50 text-rose",
    warn: "border-brass/50 text-brass",
    live: "border-rose bg-rose/15 text-rose",
  };
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-wide", tones[tone], className)} {...props} />;
}

export function Switch({ checked, onCheckedChange, disabled, label }: { checked: boolean; onCheckedChange: (value: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <SwitchPrimitive.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={label}
      className="relative h-5 w-9 shrink-0 rounded-full border border-line bg-ink data-[state=checked]:border-brass data-[state=checked]:bg-brass/80 disabled:opacity-40"
    >
      <SwitchPrimitive.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-fog transition-transform data-[state=checked]:translate-x-4 data-[state=checked]:bg-ink" />
    </SwitchPrimitive.Root>
  );
}

export function Dialog({ open, onOpenChange, title, children }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; children: React.ReactNode }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/70" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 w-[min(32rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line bg-panel p-5 shadow-2xl focus:outline-none">
          <div className="mb-4 flex items-start justify-between gap-4">
            <DialogPrimitive.Title className="font-serif text-2xl text-paper">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Close className="text-fog hover:text-paper" aria-label="Close">
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function Sheet({ open, onOpenChange, title, description, children, wide = false }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/60 data-[state=open]:animate-in" />
        <DialogPrimitive.Content
          className={cn(
            "fixed inset-y-0 right-0 z-50 flex h-full w-full flex-col border-l border-line bg-panel shadow-2xl focus:outline-none sm:max-w-xl",
            wide && "sm:max-w-2xl",
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <DialogPrimitive.Title className="font-serif text-2xl text-paper">{title}</DialogPrimitive.Title>
              {description ? <DialogPrimitive.Description className="mt-1 text-sm text-fog">{description}</DialogPrimitive.Description> : null}
            </div>
            <DialogPrimitive.Close className="rounded-md p-1 text-fog hover:bg-panel-2 hover:text-paper" aria-label="Close panel">
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (value: T) => void; options: { id: T; label: string }[] }) {
  return (
    <div role="tablist" className="inline-flex flex-wrap gap-1 rounded-md border border-line bg-ink p-1">
      {options.map((option) => {
        const active = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={cn("min-h-8 rounded px-2.5 py-1.5 text-xs", active ? "bg-panel-2 text-paper" : "text-fog hover:text-paper")}
            onClick={() => onChange(option.id)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function Toast({ tone = "info", children }: { tone?: "info" | "good" | "bad"; children: React.ReactNode }) {
  const colors = { info: "border-line text-fog", good: "border-mint/40 text-mint", bad: "border-rose/50 text-rose" };
  return <div role="status" className={cn("rounded-md border bg-panel-2 px-3 py-2 text-sm", colors[tone])}>{children}</div>;
}

export function Panel({ className, ...props }: React.ComponentProps<"section">) {
  return <section className={cn("rounded-lg border border-line bg-panel", className)} {...props} />;
}

export function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-fog">{label}</div>
      <div className={cn("mt-1 font-mono text-xl text-paper", className)}>{value}</div>
    </div>
  );
}
