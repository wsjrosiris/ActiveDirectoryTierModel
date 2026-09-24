import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

export const badgeVariants = cva(
  'inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-xs font-medium leading-4 [&_svg]:size-3 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary/10 text-primary dark:bg-primary/15',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'border-border text-muted-foreground bg-transparent',
        success: 'border-emerald-600/15 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 dark:border-emerald-400/20',
        warning: 'border-amber-600/15 bg-amber-500/10 text-amber-800 dark:text-amber-300 dark:border-amber-400/20',
        danger: 'border-rose-600/15 bg-rose-500/10 text-rose-700 dark:text-rose-300 dark:border-rose-400/20',
        info: 'border-sky-600/15 bg-sky-500/10 text-sky-700 dark:text-sky-300 dark:border-sky-400/20',
        muted: 'border-transparent bg-muted text-muted-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}
