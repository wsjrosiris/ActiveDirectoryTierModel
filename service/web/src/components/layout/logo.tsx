import { cn } from '@/lib/utils'

export function Logo({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'relative flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-500/25 ring-1 ring-inset ring-white/15',
        className,
      )}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" className="h-[60%] w-[60%]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2.5 20 6v5.5c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10V6l8-3.5Z" />
        <path d="M8 10.5h8M8 14h8" opacity={0.75} />
      </svg>
    </div>
  )
}

export function Wordmark({ className, collapsed }: { className?: string; collapsed?: boolean }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <Logo />
      {!collapsed && (
        <div className="grid leading-tight">
          <span className="text-sm font-semibold tracking-tight">Tier Model</span>
          <span className="text-[11px] text-muted-foreground">Active Directory</span>
        </div>
      )}
    </div>
  )
}
