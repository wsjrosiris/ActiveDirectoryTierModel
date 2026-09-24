import { cn } from '@/lib/utils'

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn('animate-shimmer rounded-md bg-muted', className)} {...props} />
}

/** Inline variant that is valid inside <p>/<span>. */
export function InlineSkeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cn('inline-block animate-shimmer rounded-md bg-muted align-middle', className)} />
}
