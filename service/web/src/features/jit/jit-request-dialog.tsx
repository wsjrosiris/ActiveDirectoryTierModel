import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Hourglass, Send, ShieldCheck, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError } from '@/api/client'
import { jitApi, type JitOverview } from '@/api/jit'
import { Combobox, type ComboOption } from '@/components/ui/combobox'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input, Textarea } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { Segmented } from '@/components/ui/segmented'
import { TierBadge } from '@/components/shared/badges'
import { errorMessage } from '@/lib/query'
import type { Tier } from '@/lib/tier'
import { accountProblem, defaultDuration, durationsFor, formatMinutes } from './jit-model'

const shortDuration = (m: number) => (m % 60 === 0 ? `${m / 60} Std.` : `${m} Min.`)

/** Live account search for administrators (application users, configuration, AD on the server). Debounced. */
function useAccountOptions(search: string, enabled: boolean): { options: ComboOption[]; loading: boolean } {
  const [q, setQ] = React.useState('')
  React.useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 250)
    return () => clearTimeout(t)
  }, [search])
  const query = useQuery({
    queryKey: ['jit', 'lookup', 'accounts', q],
    queryFn: ({ signal }) => jitApi.lookup.accounts(q, signal),
    enabled,
    staleTime: 60_000,
  })
  const options = React.useMemo(
    () => (query.data ?? []).map((a) => ({ value: a.account, label: a.account, hint: `${a.displayName} · ${a.source}`, icon: <UserRound className="size-4 text-muted-foreground" /> })),
    [query.data],
  )
  return { options, loading: query.isFetching }
}

export function RequestDialog({ open, onOpenChange, overview, onCreated }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  overview: JitOverview
  onCreated?: () => void
}) {
  const qc = useQueryClient()
  const [groupId, setGroupId] = React.useState('')
  const [minutes, setMinutes] = React.useState(60)
  const [member, setMember] = React.useState(overview.defaultMemberAccount)
  const [justification, setJustification] = React.useState('')
  const [touched, setTouched] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const accounts = useAccountOptions(search, open && overview.canChooseMember)

  React.useEffect(() => {
    if (!open) return
    const first = overview.groups.length === 1 ? overview.groups[0] : undefined
    setGroupId(first ? String(first.id) : '')
    setMinutes(first ? defaultDuration(first.maxMinutes) : 60)
    setMember(overview.defaultMemberAccount)
    setJustification('')
    setTouched(false)
    // Only when the dialog opens: background refreshes of the overview must not reset the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const group = overview.groups.find((g) => String(g.id) === groupId)
  const durations = group ? durationsFor(group.maxMinutes, overview.durations) : []
  const groupOptions: ComboOption[] = overview.groups.map((g) => ({
    value: String(g.id),
    label: g.displayName,
    hint: `${g.group} · max. ${formatMinutes(g.maxMinutes)}${g.requiresApproval ? ' · mit Freigabe' : ' · ohne Freigabe'}`,
    icon: <TierBadge tier={(g.tier ?? null) as Tier} short />,
  }))

  const errors = {
    group: !group ? 'Bitte eine JIT-Gruppe wählen.' : null,
    member: overview.canChooseMember ? accountProblem(member) : null,
    justification: justification.trim().length < 5 ? 'Bitte begründen Sie den Antrag (mindestens 5 Zeichen).' : null,
  }
  const valid = !errors.group && !errors.member && !errors.justification

  const create = useMutation({
    mutationFn: () => jitApi.create({
      groupId: group!.id,
      minutes,
      justification: justification.trim(),
      memberAccount: overview.canChooseMember ? member.trim() : null,
    }),
    meta: { silent: true },
    onSuccess: (r) => {
      toast.success(`Antrag #${r.id} gestellt`, {
        description: r.status === 'Pending' ? 'Eine zweite Person mit der Rolle Operator muss freigeben.' : 'Die Mitgliedschaft wird jetzt eingetragen.',
      })
      qc.invalidateQueries({ queryKey: ['jit'] })
      onOpenChange(false)
      onCreated?.()
    },
    onError: (e) => toast.error('Antrag nicht möglich', { description: e instanceof ApiError ? e.userMessage : errorMessage(e) }),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            setTouched(true)
            if (valid) create.mutate()
          }}
        >
          <DialogHeader>
            <DialogTitle>Zugriff beantragen</DialogTitle>
            <DialogDescription>
              Die Mitgliedschaft wird mit einer Ablaufzeit eingetragen; Active Directory entfernt sie danach selbstständig.
            </DialogDescription>
          </DialogHeader>

          <Field label="JIT-Gruppe" htmlFor="jit-group" required error={touched ? errors.group : undefined}>
            <Combobox
              id="jit-group"
              value={groupId}
              onChange={(v) => {
                setGroupId(v)
                const g = overview.groups.find((x) => String(x.id) === v)
                if (g) setMinutes((m) => (m <= g.maxMinutes ? m : defaultDuration(g.maxMinutes)))
              }}
              options={groupOptions}
              allowCustom={false}
              hideValue
              placeholder="Gruppe wählen …"
              searchPlaceholder="Gruppe suchen …"
              invalid={touched && !!errors.group}
            />
          </Field>

          {group && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <TierBadge tier={(group.tier ?? null) as Tier} />
              <span className="font-mono">{group.group}</span>
              <span>· höchstens {formatMinutes(group.maxMinutes)}</span>
              <span className="flex items-center gap-1">
                · {group.requiresApproval ? <><Hourglass className="size-3" /> Freigabe durch eine zweite Person</> : <><ShieldCheck className="size-3" /> ohne Freigabe</>}
              </span>
            </div>
          )}

          <Field label="Dauer" required hint={group ? `Ablauf ca. ${new Date(Date.now() + minutes * 60_000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr nach Erteilung` : 'Zuerst eine Gruppe wählen.'}>
            {group ? (
              <Segmented<string>
                aria-label="Dauer"
                value={String(minutes)}
                onValueChange={(v) => setMinutes(Number(v))}
                options={durations.map((d) => ({ value: String(d), label: shortDuration(d) }))}
              />
            ) : (
              <div className="h-9 rounded-md border border-dashed" />
            )}
          </Field>

          <Field
            label="AD-Konto"
            htmlFor="jit-member"
            required
            error={touched ? errors.member : undefined}
            hint={overview.canChooseMember ? 'Als Administrator können Sie ein anderes Konto wählen.' : 'Ihr eigenes AD-Konto – andere Konten können nur Administratoren beantragen.'}
          >
            {overview.canChooseMember ? (
              <Combobox
                id="jit-member"
                value={member}
                onChange={setMember}
                options={accounts.options}
                onSearchChange={setSearch}
                loading={accounts.loading}
                placeholder="Konto wählen …"
                searchPlaceholder="Konto suchen oder samAccountName eingeben …"
                validateCustom={accountProblem}
                invalid={touched && !!errors.member}
                mono
              />
            ) : (
              <Input id="jit-member" value={member} readOnly className="font-mono" />
            )}
          </Field>

          <Field label="Begründung" htmlFor="jit-justification" required error={touched ? errors.justification : undefined}>
            <Textarea
              id="jit-justification"
              rows={3}
              maxLength={1000}
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="z. B. Change CHG-1234: Zertifikatsvorlage auf der CA anpassen"
              aria-invalid={(touched && !!errors.justification) || undefined}
            />
          </Field>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Abbrechen</Button>
            <Button type="submit" loading={create.isPending}>{!create.isPending && <Send />} Beantragen</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
