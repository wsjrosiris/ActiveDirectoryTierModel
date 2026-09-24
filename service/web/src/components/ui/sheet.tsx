import * as React from 'react'
import { Dialog as D } from 'radix-ui'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DialogOverlay } from './dialog'

export const Sheet = D.Root
export const SheetTrigger = D.Trigger
export const SheetClose = D.Close

export function SheetContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof D.Content>) {
  return (
    <D.Portal>
      <DialogOverlay className="backdrop-blur-none bg-black/25 dark:bg-black/50" />
      <D.Content
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex h-full w-full flex-col border-l bg-popover text-popover-foreground shadow-2xl outline-none sm:max-w-xl data-[state=open]:animate-sheet-in data-[state=closed]:animate-sheet-out',
          className,
        )}
        {...props}
      >
        {children}
        <D.Close
          className="absolute top-4 right-4 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring outline-none"
          aria-label="Schließen"
        >
          <X className="size-4" />
        </D.Close>
      </D.Content>
    </D.Portal>
  )
}

export function SheetHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('grid gap-1 border-b px-6 py-5 pr-12', className)} {...props} />
}

export function SheetBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex-1 overflow-y-auto px-6 py-5', className)} {...props} />
}

export function SheetFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-center justify-end gap-2 border-t bg-muted/30 px-6 py-3', className)} {...props} />
}

export function SheetTitle({ className, ...props }: React.ComponentProps<typeof D.Title>) {
  return <D.Title className={cn('text-base font-semibold tracking-tight', className)} {...props} />
}

export function SheetDescription({ className, ...props }: React.ComponentProps<typeof D.Description>) {
  return <D.Description className={cn('text-sm text-muted-foreground', className)} {...props} />
}
