import * as React from 'react'
import { Tooltip as T } from 'radix-ui'
import { cn } from '@/lib/utils'

export const TooltipProvider = T.Provider

export function Tooltip({
  content,
  children,
  side = 'top',
  align,
  disabled,
}: {
  content: React.ReactNode
  children: React.ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  disabled?: boolean
}) {
  if (disabled || !content) return <>{children}</>
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          align={align}
          sideOffset={6}
          className={cn(
            'z-[60] max-w-xs rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background shadow-md data-[state=delayed-open]:animate-in data-[state=closed]:animate-out',
          )}
        >
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  )
}
