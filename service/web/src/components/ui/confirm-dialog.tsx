import * as React from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from './button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './dialog'
import { Input } from './input'
import { cn } from '@/lib/utils'

interface ConfirmOptions {
  title: string
  description?: React.ReactNode
  confirmText?: string
  cancelText?: string
  destructive?: boolean
  /** When set, the user must type this word to enable the confirm button. */
  typeToConfirm?: string
}

type Resolver = (ok: boolean) => void

const ConfirmContext = React.createContext<(o: ConfirmOptions) => Promise<boolean>>(() => Promise.resolve(false))

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = React.useState<ConfirmOptions | null>(null)
  const [typed, setTyped] = React.useState('')
  const resolver = React.useRef<Resolver | null>(null)

  const confirm = React.useCallback((o: ConfirmOptions) => {
    setOpts(o)
    setTyped('')
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
    })
  }, [])

  const close = (ok: boolean) => {
    resolver.current?.(ok)
    resolver.current = null
    setOpts(null)
  }

  const blocked = !!opts?.typeToConfirm && typed !== opts.typeToConfirm

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog open={!!opts} onOpenChange={(o) => !o && close(false)}>
        <DialogContent className="max-w-md" hideClose>
          {opts && (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (!blocked) close(true)
              }}
              className="grid gap-4"
            >
              <DialogHeader className="pr-0">
                <div className="flex items-start gap-3">
                  {opts.destructive && (
                    <div className="grid size-9 shrink-0 place-content-center rounded-full bg-destructive/10 text-destructive">
                      <AlertTriangle className="size-4" />
                    </div>
                  )}
                  <div className="grid gap-1.5">
                    <DialogTitle>{opts.title}</DialogTitle>
                    {opts.description && <DialogDescription asChild><div>{opts.description}</div></DialogDescription>}
                  </div>
                </div>
              </DialogHeader>
              {opts.typeToConfirm && (
                <div className={cn('grid gap-2', opts.destructive && 'sm:pl-12')}>
                  <label htmlFor="confirm-type" className="text-[13px] text-muted-foreground">
                    Zur Bestätigung <span className="font-mono font-semibold text-foreground">{opts.typeToConfirm}</span> eingeben
                  </label>
                  <Input
                    id="confirm-type"
                    autoFocus
                    autoComplete="off"
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    className="font-mono"
                  />
                </div>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => close(false)}>
                  {opts.cancelText ?? 'Abbrechen'}
                </Button>
                <Button
                  type="submit"
                  variant={opts.destructive ? 'destructive' : 'default'}
                  disabled={blocked}
                  autoFocus={!opts.typeToConfirm}
                >
                  {opts.confirmText ?? 'Bestätigen'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useConfirm() {
  return React.useContext(ConfirmContext)
}
