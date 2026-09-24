import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { AlertCircle, Eye, EyeOff, KeyRound, Lock, LogIn, ShieldOff, UserX } from 'lucide-react'
import { api, ApiError } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Logo } from '@/components/layout/logo'
import { formatDateTime } from '@/lib/utils'
import { meQueryKey, useMe } from './auth'
import { AuthShell } from './auth-shell'
import { draftStore } from '@/features/config/draft-store'
import { t } from '@/i18n'

const windowsErrors: Record<string, { title: string; text: string; tone: 'danger' | 'warning'; icon: React.ReactNode }> = {
  'windows-disabled': {
    title: t('auth.login.windowsSignInNotEnabled'),
    text: t('auth.login.signingInWithTheWindows'),
    tone: 'warning',
    icon: <ShieldOff className="mt-0.5 size-4 shrink-0" />,
  },
  'windows-failed': {
    title: t('auth.login.windowsSignInFailed'),
    text: t('auth.login.yourWindowsAccountCouldNot'),
    tone: 'danger',
    icon: <AlertCircle className="mt-0.5 size-4 shrink-0" />,
  },
  'windows-norole': {
    title: t('auth.login.accessDenied'),
    text: t('auth.login.yourWindowsAccountIsNot'),
    tone: 'warning',
    icon: <UserX className="mt-0.5 size-4 shrink-0" />,
  },
  'windows-inactive': {
    title: t('auth.login.accountDisabled'),
    text: t('auth.login.yourWindowsAccountHasBeen'),
    tone: 'danger',
    icon: <Lock className="mt-0.5 size-4 shrink-0" />,
  },
  'entra-disabled': {
    title: t('auth.login.signInWithMicrosoftNot'),
    text: t('auth.login.signingInWithMicrosoftEntra'),
    tone: 'warning',
    icon: <ShieldOff className="mt-0.5 size-4 shrink-0" />,
  },
  'entra-failed': {
    title: t('auth.login.signInWithMicrosoftFailed'),
    text: t('auth.login.theResponseFromMicrosoftEntra'),
    tone: 'danger',
    icon: <AlertCircle className="mt-0.5 size-4 shrink-0" />,
  },
  'entra-cancelled': {
    title: t('auth.login.signInCancelled'),
    text: t('auth.login.theSignInAtMicrosoft'),
    tone: 'warning',
    icon: <AlertCircle className="mt-0.5 size-4 shrink-0" />,
  },
  'entra-unreachable': {
    title: t('auth.login.microsoftEntraIdUnreachable'),
    text: t('auth.login.theServiceCouldNotRetrieve'),
    tone: 'danger',
    icon: <AlertCircle className="mt-0.5 size-4 shrink-0" />,
  },
  'entra-norole': {
    title: t('auth.login.accessDenied'),
    text: t('auth.login.yourMicrosoftAccountIsNot'),
    tone: 'warning',
    icon: <UserX className="mt-0.5 size-4 shrink-0" />,
  },
  'entra-overage': {
    title: t('auth.login.accessDenied'),
    text: t('auth.login.yourAccountIsAMember'),
    tone: 'warning',
    icon: <UserX className="mt-0.5 size-4 shrink-0" />,
  },
  'entra-tenant': {
    title: t('auth.login.wrongTenant'),
    text: t('auth.login.theMicrosoftAccountDoesNot'),
    tone: 'danger',
    icon: <ShieldOff className="mt-0.5 size-4 shrink-0" />,
  },
  'entra-inactive': {
    title: t('auth.login.accountDisabled'),
    text: t('auth.login.yourMicrosoftAccountHasBeen'),
    tone: 'danger',
    icon: <Lock className="mt-0.5 size-4 shrink-0" />,
  },
}

/** The four-square Microsoft mark, as required for "Sign in with Microsoft" buttons. */
function MicrosoftLogo() {
  return (
    <svg viewBox="0 0 21 21" aria-hidden="true" className="size-4">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  )
}

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
  const errorCode = params.get('error')
  const options = useQuery({ queryKey: ['auth', 'options'], queryFn: api.auth.options, staleTime: 5 * 60_000, retry: false, meta: { silent: true } })
  const windowsAuth = options.data?.windowsAuth === true
  const entraAuth = options.data?.entraAuth === true
  const [redirecting, setRedirecting] = React.useState<'windows' | 'entra' | false>(false)
  // Coming back via the browser's back button (bfcache) must not leave the button spinning.
  React.useEffect(() => {
    const reset = () => setRedirecting(false)
    window.addEventListener('pageshow', reset)
    return () => window.removeEventListener('pageshow', reset)
  }, [])

  const login = useMutation({
    mutationFn: () => api.auth.login({ username: username.trim(), password }),
    meta: { silent: true },
    onSuccess: async (user) => {
      // Never carry unsaved drafts of a previous session over to another account.
      draftStore.discardAll()
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
  // A local login attempt replaces the message of an earlier Windows sign-in.
  const winErr = !err && errorCode
    ? windowsErrors[errorCode] ?? { title: t('auth.login.signInFailed'), text: t('auth.login.pleaseTryAgain'), tone: 'danger' as const, icon: <AlertCircle className="mt-0.5 size-4 shrink-0" /> }
    : null

  return (
    <AuthShell>
      <div className="mb-8 flex flex-col items-center text-center">
        <Logo className="mb-5 size-11 rounded-xl" />
        <h1 className="text-xl font-semibold tracking-tight">{t('auth.login.signInToTierModel')}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{t('auth.login.manageDeployAndAuditThe')}</p>
      </div>

      {winErr && (
        <div
          role="alert"
          className={
            'mb-4 flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-[13px] ' +
            (winErr.tone === 'warning'
              ? 'border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200'
              : 'border-destructive/25 bg-destructive/10 text-destructive')
          }
        >
          {winErr.icon}
          <div>
            <p className="font-medium">{winErr.title}</p>
            <p className="mt-0.5 opacity-90">{winErr.text}</p>
          </div>
        </div>
      )}

      {(windowsAuth || entraAuth) && (
        <>
          <div className="grid gap-2.5">
            {windowsAuth && (
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="h-11 w-full gap-2.5 border-primary/30 bg-primary/5 font-semibold text-foreground hover:border-primary/50 hover:bg-primary/10"
                loading={redirecting === 'windows'}
                disabled={!!redirecting}
                onClick={() => {
                  setRedirecting('windows')
                  window.location.assign(api.auth.windowsLoginUrl(target))
                }}
              >
                {redirecting !== 'windows' && <KeyRound className="text-primary" />} {t('auth.login.signInWithWindowsAccount')}
              </Button>
            )}
            {entraAuth && (
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="h-11 w-full gap-2.5 font-semibold text-foreground"
                loading={redirecting === 'entra'}
                disabled={!!redirecting}
                onClick={() => {
                  setRedirecting('entra')
                  window.location.assign(api.auth.entraLoginUrl(target))
                }}
              >
                {redirecting !== 'entra' && <MicrosoftLogo />} {t('auth.login.signInWithMicrosoft')}
              </Button>
            )}
          </div>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            {windowsAuth && entraAuth ? t('auth.login.singleSignOnWithYour') : windowsAuth ? t('auth.login.singleSignOnWithYour2') : t('auth.login.signInWithYourMicrosoft')}
          </p>
          <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground" role="separator" aria-label={t('auth.login.or')}>
            <span className="h-px flex-1 bg-border" />
            {t('auth.login.or')}
            <span className="h-px flex-1 bg-border" />
          </div>
        </>
      )}

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
                {locked ? t('auth.login.accountTemporarilyLocked') : err.status === 401 ? t('auth.login.signInFailed') : err.title}
              </p>
              <p className="mt-0.5 opacity-90">
                {locked
                  ? err.detail || t('auth.login.tooManyFailedSignIn')
                  : err.status === 401
                    ? t('auth.login.userNameOrPasswordIs')
                    : err.detail || t('auth.login.pleaseTryAgainLater')}
              </p>
            </div>
          </div>
        )}
        <div className="grid gap-1.5">
          <Label htmlFor="username">{t('auth.login.userName')}</Label>
          <Input
            id="username"
            autoComplete="username"
            autoFocus={!windowsAuth && !entraAuth}
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="h-10"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="password">{t('auth.login.password')}</Label>
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
              aria-label={show ? t('auth.login.hidePassword') : t('auth.login.showPassword')}
            >
              {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>
        <Button type="submit" size="lg" className="mt-2 h-10 w-full" loading={login.isPending} disabled={!username || !password}>
          {!login.isPending && <LogIn />} {t('auth.login.signIn')}
        </Button>
      </form>
      {data?.user?.lockedUntil && <p className="mt-4 text-center text-xs text-muted-foreground">{t('auth.login.lockedUntil')} {formatDateTime(data.user.lockedUntil)}</p>}
    </AuthShell>
  )
}
