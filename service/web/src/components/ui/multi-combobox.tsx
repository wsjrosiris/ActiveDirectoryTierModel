import * as React from 'react'
import { Command } from 'cmdk'
import { Check, Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverAnchor } from './popover'
import type { ComboOption } from './combobox'

/**
 * Multi-value picker: selected values as removable chips, a search field with suggestions
 * (optionally extended by an async search via onSearchChange), and free entries when allowCustom.
 */
export function MultiCombobox({
  values,
  onChange,
  options,
  placeholder = 'Hinzufügen …',
  emptyText = 'Keine Treffer',
  allowCustom = true,
  onSearchChange,
  loading,
  id,
  disabled,
  mono,
  invalid,
  validateCustom,
}: {
  values: string[]
  onChange: (v: string[]) => void
  options: ComboOption[]
  placeholder?: string
  emptyText?: string
  allowCustom?: boolean
  /** Called with the current search text, e.g. to query Active Directory. */
  onSearchChange?: (s: string) => void
  loading?: boolean
  id?: string
  disabled?: boolean
  mono?: boolean
  invalid?: boolean
  /** Returns an error for a typed value that must not be added (e.g. malformed e-mail address). */
  validateCustom?: (v: string) => string | null
}) {
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)
  const trimmed = search.trim()
  const lower = values.map((v) => v.toLowerCase())
  const has = (v: string) => lower.includes(v.toLowerCase())
  const showCustom = allowCustom && trimmed && !has(trimmed) && !options.some((o) => o.value.toLowerCase() === trimmed.toLowerCase())
  const customError = showCustom && validateCustom ? validateCustom(trimmed) : null
  const labelOf = (v: string) => options.find((o) => o.value.toLowerCase() === v.toLowerCase())

  const setSearchText = (s: string) => {
    setSearch(s)
    onSearchChange?.(s)
  }
  const add = (v: string) => {
    if (!has(v)) onChange([...values, v])
    setSearchText('')
    inputRef.current?.focus()
  }
  const remove = (v: string) => onChange(values.filter((x) => x !== v))

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Command
        shouldFilter
        filter={(itemValue, s) => (itemValue.toLowerCase().includes(s.toLowerCase()) ? 1 : 0)}
        className="grid gap-1.5"
      >
        <PopoverAnchor asChild>
          <div
            className={cn(
              'flex min-h-9 w-full min-w-0 flex-wrap items-center gap-1.5 rounded-md border border-input bg-card px-2 py-1.5 text-sm shadow-xs transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20',
              invalid && 'border-destructive',
              disabled && 'cursor-not-allowed opacity-50',
            )}
            onClick={() => !disabled && inputRef.current?.focus()}
          >
            {values.map((v) => {
              const o = labelOf(v)
              return (
                <span
                  key={v}
                  className="inline-flex max-w-full items-center gap-1 rounded-md border bg-muted/60 py-0.5 pr-0.5 pl-2 text-xs"
                  title={o?.hint ?? v}
                >
                  {o?.icon}
                  <span className={cn('truncate', mono && 'font-mono text-[11px]')}>{o?.label ?? v}</span>
                  {!disabled && (
                    <button
                      type="button"
                      aria-label={`${o?.label ?? v} entfernen`}
                      className="grid size-4 place-content-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                      onClick={(e) => {
                        e.stopPropagation()
                        remove(v)
                      }}
                    >
                      <X className="size-3" />
                    </button>
                  )}
                </span>
              )
            })}
            {!disabled && (
              <Command.Input
                ref={inputRef}
                id={id}
                value={search}
                onValueChange={(s) => {
                  setSearchText(s)
                  setOpen(true)
                }}
                onFocus={() => setOpen(true)}
                onKeyDown={(e) => {
                  if (e.key === 'Backspace' && !search && values.length) remove(values[values.length - 1])
                  if ((e.key === ',' || e.key === ';') && allowCustom && trimmed) {
                    e.preventDefault()
                    if (!(validateCustom?.(trimmed))) add(trimmed)
                  }
                  if (e.key === 'Escape') setOpen(false)
                }}
                placeholder={values.length ? '' : placeholder}
                className="h-6 min-w-24 flex-1 bg-transparent px-1 outline-none placeholder:text-muted-foreground"
              />
            )}
          </div>
        </PopoverAnchor>
        <PopoverContent
          className="w-[var(--radix-popover-trigger-width)] min-w-72 p-0"
          align="start"
          onOpenAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            if (inputRef.current?.parentElement?.contains(e.target as Node)) e.preventDefault()
          }}
        >
          <Command.List className="max-h-72 overflow-y-auto p-1">
            <Command.Empty className="px-3 py-5 text-center text-sm text-muted-foreground">
              {showCustom ? null : loading ? 'Suche …' : emptyText}
            </Command.Empty>
            {showCustom && (
              <Command.Item
                value={`__custom__${trimmed}`}
                disabled={!!customError}
                onSelect={() => add(trimmed)}
                className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm data-[disabled=true]:opacity-100 data-[selected=true]:bg-accent"
              >
                {customError ? (
                  <span className="text-xs text-destructive">{customError}</span>
                ) : (
                  <>
                    <Plus className="size-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Hinzufügen:</span>
                    <span className={cn('truncate', mono && 'font-mono text-xs')}>{trimmed}</span>
                  </>
                )}
              </Command.Item>
            )}
            {options
              .filter((o) => !has(o.value))
              .map((o) => (
                <Command.Item
                  key={o.value}
                  value={`${o.label ?? ''} ${o.value} ${o.hint ?? ''}`}
                  onSelect={() => add(o.value)}
                  className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm data-[selected=true]:bg-accent"
                >
                  <Check className="size-4 shrink-0 opacity-0" />
                  {o.icon}
                  <div className="grid min-w-0">
                    <span className={cn('truncate', mono && !o.label && 'font-mono text-xs')}>{o.label ?? o.value}</span>
                    {o.hint && <span className="truncate font-mono text-[11px] text-muted-foreground">{o.hint}</span>}
                  </div>
                </Command.Item>
              ))}
          </Command.List>
        </PopoverContent>
      </Command>
    </Popover>
  )
}
