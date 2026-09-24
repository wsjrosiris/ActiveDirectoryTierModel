import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { AlertCircle, ArrowLeft, Check, KeyRound, LogOut } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiError } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { meQueryKey, useLogout, useUser } from './auth'
import { AuthShell } from './auth-shell'
import { PasswordStrength } from './password-strength'

export function Component() {
  const user = useUser()
  const forced = user.mustChangePassword
  const navigate = useNavigate()
  const logout = useLogout()
  const qc = useQueryClient()
  const [current, setCurrent] = React.useState('')
  const [next, setNext] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [touched, setTouched] = React.useState(false)

  const tooShort = next.length > 0 && next.length < 12
  const mismatch = confirm.length > 0 && confirm !== next
  const sameAsOld = next.length > 0 && next === current
  const valid = current && next.length >= 12 && next === confirm && !sameAsOld

  const mutation = useMutation({
    mutationFn: () => api.auth.changePassword({ currentPassword: current, newPassword: next }),
    meta: { silent: true },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: meQueryKey })
      toast.success('Passwort geändert')
      navigate('/', { replace: true })
    },
  })
  const err = mutation.error instanceof ApiError ? mutation.error : null

  return (
    <AuthShell footer={<span>Angemeldet als <span className="font-medium text-foreground">{user.username}</span></span>}>
      <div className="mb-6 flex flex-col items-center text-center">
        <div className="mb-4 grid size-11 place-content-center rounded-xl border bg-primary/10 text-primary">
          <KeyRound className="size-5" />
        </div>
        <h1 className="text-xl font-semibold tracking-tight">Passwort ändern</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {forced
            ? 'Bevor Sie fortfahren können, müssen Sie ein neues Passwort festlegen.'
            : 'Legen Sie ein neues Passwort für Ihr Konto fest.'}
        </p>
      </div>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          setTouched(true)
          if (valid) mutation.mutate()
        }}
      >
        {err && (
          <div role="alert" className="flex items-start gap-2.5 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2.5 text-[13px] text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{err.status === 400 || err.status === 401 ? err.detail || 'Das aktuelle Passwort ist falsch oder das neue erfüllt die Richtlinie nicht.' : err.userMessage}</span>
          </div>
        )}
        <Field label="Aktuelles Passwort" htmlFor="cur">
          <Input id="cur" type="password" autoComplete="current-password" autoFocus value={current} onChange={(e) => setCurrent(e.target.value)} className="h-10" />
        </Field>
        <Field
          label="Neues Passwort"
          htmlFor="new"
          error={(touched || next.length >= 12) && tooShort ? 'Mindestens 12 Zeichen erforderlich.' : sameAsOld ? 'Das neue Passwort muss sich vom aktuellen unterscheiden.' : undefined}
        >
          <Input id="new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className="h-10" aria-invalid={(touched && tooShort) || sameAsOld || undefined} />
        </Field>
        <PasswordStrength password={next} />
        <Field label="Neues Passwort bestätigen" htmlFor="confirm" error={mismatch ? 'Die Passwörter stimmen nicht überein.' : undefined}>
          <div className="relative">
            <Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="h-10 pr-9" aria-invalid={mismatch || undefined} />
            <Check className={cn('absolute top-1/2 right-3 size-4 -translate-y-1/2 text-emerald-500 transition-opacity', confirm && confirm === next && next.length >= 12 ? 'opacity-100' : 'opacity-0')} />
          </div>
        </Field>
        <Button type="submit" size="lg" className="mt-2 h-10 w-full" disabled={!valid} loading={mutation.isPending}>
          Passwort speichern
        </Button>
        {forced ? (
          <Button type="button" variant="ghost" className="text-muted-foreground" onClick={() => logout()}>
            <LogOut /> Abmelden
          </Button>
        ) : (
          <Button type="button" variant="ghost" className="text-muted-foreground" onClick={() => navigate(-1)}>
            <ArrowLeft /> Zurück
          </Button>
        )}
      </form>
    </AuthShell>
  )
}
