import * as React from 'react'
import { Moon, Sun } from 'lucide-react'
import { useTheme } from '@/lib/theme'
import { Button } from '@/components/ui/button'
import { t } from '@/i18n'

export function AuthShell({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) {
  const { resolved, toggle } = useTheme()
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-background px-4 py-12">
      {/* backdrop */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_-10%,color-mix(in_oklch,var(--color-primary)_18%,transparent),transparent)]" />
        <div
          className="absolute inset-0 opacity-[0.35] dark:opacity-[0.2]"
          style={{
            backgroundImage:
              'linear-gradient(to right, var(--color-border) 1px, transparent 1px), linear-gradient(to bottom, var(--color-border) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
            maskImage: 'radial-gradient(ellipse 60% 55% at 50% 40%, black, transparent)',
            WebkitMaskImage: 'radial-gradient(ellipse 60% 55% at 50% 40%, black, transparent)',
          }}
        />
      </div>
      <Button variant="ghost" size="icon-sm" onClick={toggle} className="absolute top-4 right-4 text-muted-foreground" aria-label={t('auth.authShell.toggleTheme')}>
        {resolved === 'dark' ? <Sun /> : <Moon />}
      </Button>
      <div className="relative w-full max-w-[400px] rounded-2xl border bg-card/90 p-8 shadow-xl shadow-black/[0.04] backdrop-blur-sm dark:shadow-black/40">
        {children}
      </div>
      <div className="relative mt-6 flex items-center gap-3 text-xs text-muted-foreground">
        {footer ?? (
          <>
            <span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-rose-500" />Tier 0</span>
            <span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-amber-500" />Tier 1</span>
            <span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-emerald-500" />Tier 2</span>
          </>
        )}
      </div>
    </div>
  )
}
