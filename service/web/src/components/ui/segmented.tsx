import * as React from 'react'
import { ToggleGroup } from 'radix-ui'
import { cn } from '@/lib/utils'

export function Segmented<T extends string>({
  value,
  onValueChange,
  options,
  className,
  'aria-label': ariaLabel,
  disabled,
}: {
  value: T
  onValueChange: (v: T) => void
  options: { value: T; label: React.ReactNode; icon?: React.ReactNode; disabled?: boolean }[]
  className?: string
  'aria-label'?: string
  disabled?: boolean
}) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(v) => v && onValueChange(v as T)}
      aria-label={ariaLabel}
      disabled={disabled}
      className={cn('inline-flex flex-wrap gap-0.5 rounded-lg bg-muted p-0.5', className)}
    >
      {options.map((o) => (
        <ToggleGroup.Item
          key={o.value}
          value={o.value}
          disabled={o.disabled}
          className="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium text-muted-foreground transition-all outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 disabled:pointer-events-none data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-sm dark:data-[state=on]:bg-accent [&_svg]:size-3.5"
        >
          {o.icon}
          {o.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  )
}
