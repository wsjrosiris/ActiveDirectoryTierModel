import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { AlertCircle, Eye, EyeOff, Lock, LogIn } from 'lucide-react'
import { api, ApiError } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Logo } from '@/components/layout/logo'
import { formatDateTime } from '@/lib/utils'
import { meQueryKey, useMe } from './auth'
import { AuthShell } from './auth-shell'

export function Component() {
  const { data } = useMe()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [username, setUsername] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [show, setShow] = React.useState(false)

  const next = params.get('next')
  const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/'

  const login = useMutation({
    mutationFn: () => api.auth.login({ username: username.trim(), password }),
    meta: { silent: true },
    onSuccess: async (user) => {
      // Re-read /me so the XSRF cookie is refreshed for the new session.
      qc.setQueryData(meQueryKey, { user })
      await qc.invalidateQueries({ queryKey: meQueryKey })
      navigate(user.mustChangePassword ? '/passwort-aendern' : target, { replace: true })
    },
  })

  // Make sure an XSRF cookie exists before posting the login form.
  React.useEffect(() => {
    if (!data) api.auth.me().catch(() => undefined)
  }, [data])

  if (data?.user && !login.isPending && !login.isSuccess) {
    return <Navigate to={data.user.mustChangePassword ? '/passwort-aendern' : target} replace />
  }

  const err = login.error instanceof ApiError ? login.error : login.error ? new ApiError(0, {}) : null
  const locked = err?.status === 423

  return (
    <AuthShell>
      <div className="mb-8 flex flex-col items-center text-center">
        <Logo className="mb-5 size-11 rounded-xl" />
        <h1 className="text-xl font-semibold tracking-tight">Bei Tier Model anmelden</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">Active Directory Tier-Modell verwalten, bereitstellen und prüfen</p>
      </div>

      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (username && password) login.mutate()
        }}
      >
        {err && (
          <div
            role="alert"
            className={
              'flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-[13px] ' +
              (locked
                ? 'border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200'
                : 'border-destructive/25 bg-destructive/10 text-destructive')
            }
          >
            {locked ? <Lock className="mt-0.5 size-4 shrink-0" /> : <AlertCircle className="mt-0.5 size-4 shrink-0" />}
            <div>
              <p className="font-medium">
                {locked ? 'Konto vorübergehend gesperrt' : err.status === 401 ? 'Anmeldung fehlgeschlagen' : err.title}
              </p>
              <p className="mt-0.5 opacity-90">
                {locked
                  ? err.detail || 'Zu viele fehlgeschlagene Anmeldeversuche. Bitte später erneut versuchen oder einen Administrator kontaktieren.'
                  : err.status === 401
                    ? 'Benutzername oder Passwort ist falsch.'
                    : err.detail || 'Bitte später erneut versuchen.'}
              </p>
            </div>
          </div>
        )}
        <div className="grid gap-1.5">
          <Label htmlFor="username">Benutzername</Label>
          <Input
            id="username"
            autoComplete="username"
            autoFocus
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="h-10"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="password">Passwort</Label>
          <div className="relative">
            <Input
              id="password"
              type={show ? 'text' : 'password'}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-10 pr-10"
              aria-invalid={err?.status === 401 || undefined}
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="absolute top-1/2 right-1.5 grid size-7 -translate-y-1/2 place-content-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={show ? 'Passwort verbergen' : 'Passwort anzeigen'}
            >
              {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>
        <Button type="submit" size="lg" className="mt-2 h-10 w-full" loading={login.isPending} disabled={!username || !password}>
          {!login.isPending && <LogIn />} Anmelden
        </Button>
      </form>
      {data?.user?.lockedUntil && <p className="mt-4 text-center text-xs text-muted-foreground">Gesperrt bis {formatDateTime(data.user.lockedUntil)}</p>}
    </AuthShell>
  )
}
