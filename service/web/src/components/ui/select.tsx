import * as React from 'react'
import { Select as S } from 'radix-ui'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { t } from '@/i18n'

export interface SelectOption {
  value: string
  label: React.ReactNode
  description?: string
}

/** Convenience select: <Select value onValueChange options /> */
export function Select({
  value,
  onValueChange,
  options,
  placeholder = t('ui.select.select'),
  disabled,
  id,
  className,
  'aria-label': ariaLabel,
  size = 'default',
}: {
  value: string | undefined
  onValueChange: (v: string) => void
  options: SelectOption[]
  placeholder?: string
  disabled?: boolean
  id?: string
  className?: string
  'aria-label'?: string
  size?: 'default' | 'sm'
}) {
  return (
    <S.Root value={value || undefined} onValueChange={onValueChange} disabled={disabled}>
      <S.Trigger
        id={id}
        aria-label={ariaLabel}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-md border border-input bg-card px-3 text-sm shadow-xs outline-none transition-[border-color,box-shadow] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50 data-[placeholder]:text-muted-foreground [&>span]:truncate',
          size === 'sm' ? 'h-8 text-[13px]' : 'h-9',
          className,
        )}
      >
        <S.Value placeholder={placeholder} />
        <S.Icon asChild>
          <ChevronDown className="size-4 shrink-0 opacity-60" />
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content
          position="popper"
          sideOffset={4}
          className="z-50 max-h-[min(var(--radix-select-content-available-height),22rem)] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg shadow-black/5 data-[state=open]:animate-in"
        >
          <S.Viewport className="p-1">
            {options.map((o) => (
              <S.Item
                key={o.value}
                value={o.value}
                className="relative flex cursor-default select-none items-center rounded-md py-1.5 pr-8 pl-2 text-sm outline-none focus:bg-accent data-[disabled]:opacity-50"
              >
                <div className="grid">
                  <S.ItemText>{o.label}</S.ItemText>
                  {o.description && <span className="text-xs text-muted-foreground">{o.description}</span>}
                </div>
                <S.ItemIndicator className="absolute right-2 inline-flex">
                  <Check className="size-4" />
                </S.ItemIndicator>
              </S.Item>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  )
}
