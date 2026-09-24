import * as React from 'react'
import { Command } from 'cmdk'
import { Check, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from './popover'

export interface ComboOption {
  value: string
  label?: string
  hint?: string
  icon?: React.ReactNode
}

/**
 * Searchable combobox. Allows free text entry (allowCustom) so users can
 * reference objects that are not part of the configuration (e.g. built-in groups).
 */
export function Combobox({
  value,
  onChange,
  options,
  placeholder = 'Auswählen…',
  searchPlaceholder = 'Suchen…',
  emptyText = 'Keine Treffer',
  allowCustom = true,
  id,
  disabled,
  mono,
  invalid,
  onSearchChange,
  loading,
  validateCustom,
  hideValue,
}: {
  value: string
  onChange: (v: string) => void
  options: ComboOption[]
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  allowCustom?: boolean
  id?: string
  disabled?: boolean
  mono?: boolean
  invalid?: boolean
  /** Called with the current search text, e.g. to query Active Directory. */
  onSearchChange?: (s: string) => void
  loading?: boolean
  /** Returns an error for a typed value that must not be used as is. */
  validateCustom?: (v: string) => string | null
  /** Show only the option's label in the trigger (for fixed choices whose value is an internal key). */
  hideValue?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const selected = options.find((o) => o.value === value)
  const trimmed = search.trim()
  const showCustom = allowCustom && trimmed && !options.some((o) => o.value.toLowerCase() === trimmed.toLowerCase())
  const customError = showCustom && validateCustom ? validateCustom(trimmed) : null
  const setSearchText = (s: string) => {
    setSearch(s)
    onSearchChange?.(s)
  }

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSearchText('') }}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          className={cn(
            'flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-card px-3 text-left text-sm shadow-xs outline-none transition-[border-color,box-shadow] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive',
            mono && 'font-mono text-[12.5px]',
          )}
        >
          {value && selected?.label && selected.label !== value ? (
            <span className="flex min-w-0 items-baseline gap-2">
              <span className={cn('shrink-0 truncate font-sans text-sm', hideValue ? 'max-w-full' : 'max-w-[65%]')}>{selected.label}</span>
              {!hideValue && <span className="truncate font-mono text-[11px] text-muted-foreground">{value}</span>}
            </span>
          ) : (
            <span className={cn('truncate', !value && 'font-sans text-muted-foreground')}>{value || placeholder}</span>
          )}
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-72 p-0" align="start">
        <Command
          className="flex flex-col"
          filter={(itemValue, s) => (itemValue.toLowerCase().includes(s.toLowerCase()) ? 1 : 0)}
        >
          <Command.Input
            value={search}
            onValueChange={setSearchText}
            placeholder={searchPlaceholder}
            className="h-10 border-b bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground"
          />
          <Command.List className="max-h-72 overflow-y-auto p-1">
            <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">
              {showCustom ? null : loading ? 'Suche …' : emptyText}
            </Command.Empty>
            {showCustom && (
              <Command.Item
                value={`__custom__${trimmed}`}
                disabled={!!customError}
                onSelect={() => { onChange(trimmed); setOpen(false); setSearchText('') }}
                className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm data-[disabled=true]:opacity-100 data-[selected=true]:bg-accent"
              >
                {customError ? (
                  <span className="text-xs text-destructive">{customError}</span>
                ) : (
                  <>
                    <span className="text-muted-foreground">Verwenden:</span>
                    <span className={cn('truncate', mono && 'font-mono text-xs')}>{trimmed}</span>
                  </>
                )}
              </Command.Item>
            )}
            {loading && showCustom && <p className="px-2 py-1.5 text-xs text-muted-foreground">Suche im Active Directory …</p>}
            {options.map((o) => (
              <Command.Item
                key={o.value}
                value={`${o.label ?? ''} ${o.value} ${o.hint ?? ''}`}
                onSelect={() => { onChange(o.value); setOpen(false); setSearchText('') }}
                className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm data-[selected=true]:bg-accent"
              >
                <Check className={cn('size-4 shrink-0', o.value === value ? 'opacity-100' : 'opacity-0')} />
                {o.icon}
                <div className="grid min-w-0">
                  <span className={cn('truncate', mono && !o.label && 'font-mono text-xs')}>{o.label ?? o.value}</span>
                  {o.hint && <span className="truncate font-mono text-[11px] text-muted-foreground">{o.hint}</span>}
                </div>
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
