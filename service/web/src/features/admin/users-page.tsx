import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { Cloud, Copy, Info, KeyRound, Lock, MonitorCheck, MoreHorizontal, Pencil, Plus, RefreshCw, Trash2, Unlock, UserPlus, Users } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import type { Role, User } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { Tooltip } from '@/components/ui/tooltip'
import { Page, PageHeader } from '@/components/shared/page-header'
import { RequireAuth, useUser } from '@/features/auth/auth'
import { generatePassword, PasswordStrength } from '@/features/auth/password-strength'
import { roleDescriptions, roleLabels, roles } from '@/lib/roles'
import { cn, formatDateTime, formatRelative } from '@/lib/utils'
import { t } from '@/i18n'

export function Component() {
  return (
    <RequireAuth role="Admin">
      <UsersPage />
    </RequireAuth>
  )
}

const roleVariant: Record<Role, 'muted' | 'info' | 'warning' | 'danger'> = {
  Viewer: 'muted',
  Editor: 'info',
  Operator: 'warning',
  Admin: 'danger',
}

function isLocked(u: User) {
  return !!u.lockedUntil && new Date(u.lockedUntil).getTime() > Date.now()
}

function AuthTypeBadge({ user }: { user: User }) {
  return user.authType === 'Windows' ? (
    <Tooltip content={t('admin.users.signInViaKerberosNtlm')}>
      <Badge variant="info"><MonitorCheck /> Windows</Badge>
    </Tooltip>
  ) : user.authType === 'Entra' ? (
    <Tooltip content={t('admin.users.signInWithMicrosoftEntra')}>
      <Badge variant="info"><Cloud /> Entra ID</Badge>
    </Tooltip>
  ) : (
    <Badge variant="outline"><KeyRound /> {t('admin.users.local')}</Badge>
  )
}

function UsersPage() {
  const me = useUser()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const q = useQuery({ queryKey: ['users'], queryFn: api.users.list })
  const [editing, setEditing] = React.useState<User | 'new' | null>(null)
  const [resetFor, setResetFor] = React.useState<User | null>(null)
  const invalidate = () => qc.invalidateQueries({ queryKey: ['users'] })

  const unlock = useMutation({ mutationFn: (u: User) => api.users.unlock(u.id), onSuccess: (_d, u) => { toast.success(t('admin.users.unlockedToast', { name: u.username })); invalidate() } })
  const remove = useMutation({ mutationFn: (u: User) => api.users.remove(u.id), onSuccess: (_d, u) => { toast.success(t('admin.users.usernameDeleted', { username: u.username })); invalidate() } })

  return (
    <Page>
      <PageHeader
        icon={<Users />}
        title={t('admin.users.users')}
        description={t('admin.users.accountsAndRolesForAccess')}
        actions={<Button onClick={() => setEditing('new')}><UserPlus /> {t('admin.users.createUser')}</Button>}
      />
      <Card className="overflow-hidden">
        {q.isLoading ? (
          <div className="grid gap-2 p-5">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : !q.data?.length ? (
          <EmptyState icon={<Users />} title={t('admin.users.noUsers')} />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>{t('admin.users.user')}</TH>
                <TH>{t('common.role')}</TH>
                <TH className="hidden sm:table-cell">{t('admin.users.signIn')}</TH>
                <TH>{t('common.status')}</TH>
                <TH className="hidden md:table-cell">{t('admin.users.lastSignIn')}</TH>
                <TH className="hidden xl:table-cell">{t('admin.users.created')}</TH>
                <TH className="w-10"><span className="sr-only">{t('common.actions')}</span></TH>
              </TR>
            </THead>
            <TBody>
              {q.data.map((u) => (
                <TR key={u.id} className={cn(!u.isActive && 'text-muted-foreground')}>
                  <TD>
                    <div className="flex items-center gap-3">
                      <span className="grid size-8 shrink-0 place-content-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                        {(u.displayName || u.username).slice(0, 2).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">
                          {u.displayName || u.username}
                          {u.id === me.id && <span className="ml-2 text-xs font-normal text-muted-foreground">{t('admin.users.you')}</span>}
                        </p>
                        <p className="truncate font-mono text-xs text-muted-foreground">{u.username}</p>
                      </div>
                    </div>
                  </TD>
                  <TD>
                    {u.authType !== 'Local' ? (
                      <Tooltip content={u.authType === 'Entra' ? t('admin.users.determinedFromEntraIdAt') : t('admin.users.determinedFromTheAdGroups')}>
                        <Badge variant={roleVariant[u.role]}>{roleLabels[u.role]}</Badge>
                      </Tooltip>
                    ) : (
                      <Badge variant={roleVariant[u.role]}>{roleLabels[u.role]}</Badge>
                    )}
                  </TD>
                  <TD className="hidden sm:table-cell"><AuthTypeBadge user={u} /></TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      {!u.isActive ? <Badge variant="muted">{t('admin.users.disabled')}</Badge> : isLocked(u) ? (
                        <Tooltip content={t('admin.users.lockedUntilLockeduntil', { lockedUntil: formatDateTime(u.lockedUntil) })}><Badge variant="danger"><Lock /> {t('admin.users.locked')}</Badge></Tooltip>
                      ) : <Badge variant="success">{t('common.active')}</Badge>}
                      {u.mustChangePassword && u.authType === 'Local' && <Badge variant="warning">{t('admin.users.passwordChange')}</Badge>}
                    </div>
                  </TD>
                  <TD className="hidden text-[13px] md:table-cell" title={formatDateTime(u.lastLoginAt)}>{u.lastLoginAt ? formatRelative(u.lastLoginAt) : t('admin.users.never')}</TD>
                  <TD className="hidden text-[13px] text-muted-foreground xl:table-cell">{formatDateTime(u.createdAt)}</TD>
                  <TD>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-xs" aria-label={t('admin.users.actionsForUsername', { username: u.username })}><MoreHorizontal /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setEditing(u)}><Pencil /> {t('common.edit')}</DropdownMenuItem>
                        {u.authType === 'Local' && <DropdownMenuItem onSelect={() => setResetFor(u)}><KeyRound /> {t('admin.users.resetPassword')}</DropdownMenuItem>}
                        {isLocked(u) && <DropdownMenuItem onSelect={() => unlock.mutate(u)}><Unlock /> {t('admin.users.unlock')}</DropdownMenuItem>}
                        {u.id !== me.id && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              destructive
                              onSelect={async () => {
                                if (await confirm({ title: t('admin.users.deleteUserUsername', { username: u.username }), description: t('admin.users.theAccountIsRemovedPermanently'), confirmText: t('common.delete'), destructive: true }))
                                  remove.mutate(u)
                              }}
                            >
                              <Trash2 /> {t('common.delete')}
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <UserSheet value={editing} onClose={() => setEditing(null)} selfId={me.id} />
      <ResetPasswordDialog user={resetFor} onClose={() => setResetFor(null)} />
    </Page>
  )
}

function PasswordField({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const [show, setShow] = React.useState(false)
  return (
    <div className="grid gap-2">
      <div className="flex gap-2">
        <Input id={id} type={show ? 'text' : 'password'} autoComplete="new-password" className="font-mono" value={value} onChange={(e) => onChange(e.target.value)} />
        <Tooltip content={t('admin.users.generateASecurePassword')}>
          <Button type="button" variant="outline" size="icon" onClick={() => { onChange(generatePassword()); setShow(true) }} aria-label={t('admin.users.generatePassword')}>
            <RefreshCw />
          </Button>
        </Tooltip>
        <Tooltip content={t('admin.users.copy')}>
          <Button type="button" variant="outline" size="icon" disabled={!value} onClick={() => navigator.clipboard.writeText(value).then(() => toast.success(t('admin.users.passwordCopied')))} aria-label={t('admin.users.copyPassword')}>
            <Copy />
          </Button>
        </Tooltip>
      </div>
      <PasswordStrength password={value} />
    </div>
  )
}

function UserSheet({ value, onClose, selfId }: { value: User | 'new' | null; onClose: () => void; selfId: string }) {
  const isNew = value === 'new'
  const user = value && value !== 'new' ? value : null
  const qc = useQueryClient()
  const [username, setUsername] = React.useState('')
  const [displayName, setDisplayName] = React.useState('')
  const [role, setRole] = React.useState<Role>('Viewer')
  const [isActive, setActive] = React.useState(true)
  const [password, setPassword] = React.useState('')

  React.useEffect(() => {
    if (!value) return
    setUsername(user?.username ?? '')
    setDisplayName(user?.displayName ?? '')
    setRole(user?.role ?? 'Viewer')
    setActive(user?.isActive ?? true)
    setPassword(isNew ? generatePassword() : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const save = useMutation({
    mutationFn: () =>
      isNew
        ? api.users.create({ username: username.trim(), displayName: displayName.trim(), role, password })
        : api.users.update(user!.id, { displayName: displayName.trim(), role, isActive }),
    onSuccess: (u) => {
      qc.invalidateQueries({ queryKey: ['users'] })
      toast.success(isNew ? t('admin.users.userUsernameCreated', { username: u.username }) : t('admin.users.changesSaved'), {
        description: isNew ? t('admin.users.theUserMustChangeThe') : undefined,
      })
      onClose()
    },
  })
  const self = user?.id === selfId
  const windows = user?.authType === 'Windows'
  const entra = user?.authType === 'Entra'
  const error = isNew && !username.trim() ? t('admin.users.userNameRequired') : isNew && password.length < 12 ? t('admin.users.passwordMustHaveAtLeast') : null

  return (
    <Sheet open={!!value} onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <form className="flex h-full flex-col" onSubmit={(e) => { e.preventDefault(); if (!error) save.mutate() }}>
          <SheetHeader>
            <SheetTitle>{isNew ? t('admin.users.createLocalUser') : t('admin.users.editTitle', { name: user?.username })}</SheetTitle>
            <SheetDescription>
              {isNew
                ? t('admin.users.theInitialPasswordMustBe')
                : windows || entra
                  ? t('admin.users.valueAccountDisplayNameAnd', { value: entra ? t('admin.users.entraId') : 'Windows' })
                  : t('admin.users.roleAndStatusOfThe')}
            </SheetDescription>
          </SheetHeader>
          <SheetBody className="grid content-start gap-5">
            {isNew && (
              <div className="flex gap-2.5 rounded-lg border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
                <Info className="mt-px size-4 shrink-0" />
                <p>
                  {t('admin.users.onlyLocalAccountsAreCreated')}{' '}
                  <Link to="/admin/windows-anmeldung" className="font-medium text-primary hover:underline" onClick={onClose}>{t('admin.users.windowsSignIn')}</Link>.
                </p>
              </div>
            )}
            <Field label={t('admin.users.userName')} htmlFor="u-username" required={isNew}>
              <Input id="u-username" value={username} onChange={(e) => setUsername(e.target.value)} readOnly={!isNew} autoComplete="off" className="font-mono" autoFocus={isNew} />
            </Field>
            <Field label={t('admin.users.displayName')} htmlFor="u-display">
              <Input id="u-display" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={t('admin.users.firstNameLastName')} />
            </Field>
            <div className="grid gap-2">
              <p className="text-[13px] font-medium">{t('common.role')}</p>
              <div role="radiogroup" aria-label={t('common.role')} className="grid gap-2">
                {roles.map((r) => (
                  <button
                    key={r}
                    type="button"
                    role="radio"
                    aria-checked={role === r}
                    disabled={windows || entra ? r !== role : self && r !== 'Admin'}
                    onClick={() => setRole(r)}
                    className={cn(
                      'flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-all outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45',
                      role === r && 'border-primary/50 bg-primary/5 ring-1 ring-primary/30',
                    )}
                  >
                    <span className={cn('grid size-4 shrink-0 place-content-center rounded-full border', role === r ? 'border-primary bg-primary' : 'border-input')}>
                      {role === r && <span className="size-1.5 rounded-full bg-primary-foreground" />}
                    </span>
                    <span className="grid">
                      <span className="text-[13px] font-medium">{roleLabels[r]}</span>
                      <span className="text-xs text-muted-foreground">{roleDescriptions[r]}</span>
                    </span>
                  </button>
                ))}
              </div>
              {windows ? (
                <div className="flex gap-2.5 rounded-lg border border-sky-500/25 bg-sky-500/5 px-3 py-2.5 text-xs text-sky-900 dark:text-sky-200">
                  <MonitorCheck className="mt-px size-4 shrink-0" />
                  <p>
                    {t('admin.users.theRoleOfAWindows')}{' '}
                    <Link to="/admin/windows-anmeldung" className="font-medium underline underline-offset-2" onClick={onClose}>{t('admin.users.windowsSignIn')}</Link>.
                  </p>
                </div>
              ) : entra ? (
                <div className="flex gap-2.5 rounded-lg border border-sky-500/25 bg-sky-500/5 px-3 py-2.5 text-xs text-sky-900 dark:text-sky-200">
                  <Cloud className="mt-px size-4 shrink-0" />
                  <p>
                    {t('admin.users.theRoleOfAnEntra')}{' '}
                    <Link to="/admin/entra-anmeldung" className="font-medium underline underline-offset-2" onClick={onClose}>{t('admin.users.entraIdSignIn')}</Link>.
                  </p>
                </div>
              ) : self ? (
                <p className="text-xs text-muted-foreground">{t('admin.users.youCannotRemoveYourOwn')}</p>
              ) : null}
            </div>
            {isNew ? (
              <Field label={t('admin.users.initialPassword')} htmlFor="u-pw" required>
                <PasswordField id="u-pw" value={password} onChange={setPassword} />
              </Field>
            ) : (
              <label htmlFor="u-active" className="flex items-center justify-between gap-4 rounded-lg border px-3.5 py-3">
                <span className="grid">
                  <span className="text-[13px] font-medium">{t('admin.users.accountActive')}</span>
                  <span className="text-xs text-muted-foreground">{t('admin.users.disabledAccountsCannotSignIn')}</span>
                </span>
                <Switch id="u-active" checked={isActive} disabled={self} onCheckedChange={setActive} />
              </label>
            )}
          </SheetBody>
          <SheetFooter>
            {error && <span className="mr-auto text-xs text-muted-foreground">{error}</span>}
            <Button type="button" variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
            <Button type="submit" disabled={!!error} loading={save.isPending}>{isNew ? <><Plus /> {t('admin.users.create')}</> : t('common.save')}</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}

function ResetPasswordDialog({ user, onClose }: { user: User | null; onClose: () => void }) {
  const [pw, setPw] = React.useState('')
  const qc = useQueryClient()
  React.useEffect(() => {
    if (user) setPw(generatePassword())
  }, [user])
  const reset = useMutation({
    mutationFn: () => api.users.resetPassword(user!.id, pw),
    onSuccess: () => {
      toast.success(t('admin.users.passwordReset'), { description: t('admin.users.theUserMustChangeIt') })
      qc.invalidateQueries({ queryKey: ['users'] })
      onClose()
    },
  })
  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.users.resetPassword')}</DialogTitle>
          <DialogDescription>{t('admin.users.newTemporaryPasswordFor')} <span className="font-medium text-foreground">{user?.username}</span>{t('admin.users.shareItSecurely')}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (pw.length >= 12) reset.mutate() }}>
          <Field label={t('admin.users.newPassword')} htmlFor="reset-pw">
            <PasswordField id="reset-pw" value={pw} onChange={setPw} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
            <Button type="submit" disabled={pw.length < 12} loading={reset.isPending}>{t('common.reset')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
