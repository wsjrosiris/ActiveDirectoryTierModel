import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowDownToLine, Copy, Download, Search, Terminal, WrapText } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import type { LogLine, RunStatus } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { cn, formatTime } from '@/lib/utils'
import { ApiError } from '@/api/client'
import { t } from '@/i18n'

const ACTIVE: RunStatus[] = ['Queued', 'Running']

/**
 * Polls /api/runs/{id}/log?after= every second while the run is active.
 * A run awaiting approval has no log yet: polling pauses (the detail query keeps refreshing the run)
 * and starts again as soon as the run status turns Queued/Running after the approval.
 */
export function useRunLog(runId: number, runStatus: RunStatus | undefined) {
  const [lines, setLines] = React.useState<LogLine[]>([])
  const [status, setStatus] = React.useState<RunStatus | undefined>(runStatus)
  const [loaded, setLoaded] = React.useState(false)
  const after = React.useRef(0)
  const qc = useQueryClient()
  const awaiting = runStatus === 'AwaitingApproval'

  React.useEffect(() => {
    after.current = 0
    setLines([])
    setLoaded(false)
  }, [runId])

  React.useEffect(() => {
    if (awaiting) {
      setStatus('AwaitingApproval')
      setLoaded(true)
      return
    }
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const ctrl = new AbortController()
    const tick = async () => {
      try {
        // Drain: the API returns max. 2000 lines per request.
        let more = true
        let lastStatus: RunStatus | undefined
        while (more && !stopped) {
          const res = await api.runs.log(runId, after.current, ctrl.signal)
          lastStatus = res.status
          if (res.lines.length) {
            after.current = res.lines[res.lines.length - 1].seq
            setLines((prev) => prev.concat(res.lines))
          }
          more = res.lines.length >= 2000
        }
        if (stopped) return
        setLoaded(true)
        setStatus((prev) => {
          if (prev && ACTIVE.includes(prev) && lastStatus && !ACTIVE.includes(lastStatus)) {
            // Run finished → refresh detail (findings, summary, exit code).
            qc.invalidateQueries({ queryKey: ['run', runId] })
            qc.invalidateQueries({ queryKey: ['runs'] })
            qc.invalidateQueries({ queryKey: ['dashboard'] })
          }
          return lastStatus
        })
        if (lastStatus && ACTIVE.includes(lastStatus)) timer = setTimeout(tick, 1000)
      } catch (e) {
        if ((e as Error).name === 'AbortError' || stopped) return
        setLoaded(true)
        // A missing run or missing permission will not fix itself: stop polling.
        if (e instanceof ApiError && (e.status === 403 || e.status === 404)) return
        timer = setTimeout(tick, 3000)
      }
    }
    tick()
    return () => {
      stopped = true
      ctrl.abort()
      if (timer) clearTimeout(timer)
    }
  }, [runId, qc, awaiting])

  return { lines, status, loaded }
}

const levelClass: Record<LogLine['level'], string> = {
  info: 'text-terminal-foreground',
  warn: 'text-amber-300',
  error: 'text-rose-400',
  success: 'text-emerald-400',
}

export function RunLog({
  lines,
  active,
  loaded,
  runId,
  emptyText,
}: {
  lines: LogLine[]
  active: boolean
  loaded: boolean
  runId: number
  /** Replaces the default "no output" text, e.g. for runs that never started. */
  emptyText?: string
}) {
  const [follow, setFollow] = React.useState(true)
  const [wrap, setWrap] = React.useState(true)
  const [filter, setFilter] = React.useState('')
  const [level, setLevel] = React.useState<'all' | 'problems'>('all')
  const scroller = React.useRef<HTMLDivElement>(null)
  const programmatic = React.useRef(false)

  const shown = React.useMemo(() => {
    const q = filter.trim().toLowerCase()
    return lines.filter((l) => (level === 'all' || l.level === 'warn' || l.level === 'error') && (!q || l.text.toLowerCase().includes(q)))
  }, [lines, filter, level])

  React.useLayoutEffect(() => {
    const el = scroller.current
    if (follow && el) {
      programmatic.current = true
      el.scrollTop = el.scrollHeight
    }
  }, [shown, follow])

  const onScroll = () => {
    const el = scroller.current
    if (!el) return
    if (programmatic.current) {
      programmatic.current = false
      return
    }
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24
    if (!atBottom && follow) setFollow(false)
    if (atBottom && !follow) setFollow(true)
  }

  const asText = () => lines.map((l) => `${l.at} [${l.stream}/${l.level}] ${l.text}`).join('\n')
  const counts = React.useMemo(() => ({
    warn: lines.filter((l) => l.level === 'warn').length,
    error: lines.filter((l) => l.level === 'error').length,
  }), [lines])

  return (
    <div className="overflow-hidden rounded-xl border border-black/10 bg-terminal shadow-lg shadow-black/5 dark:border-white/10">
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-white/[0.03] px-3 py-2 text-terminal-foreground">
        <div className="flex items-center gap-1.5 pr-2" aria-hidden>
          <span className="size-2.5 rounded-full bg-rose-400/80" />
          <span className="size-2.5 rounded-full bg-amber-300/80" />
          <span className="size-2.5 rounded-full bg-emerald-400/80" />
        </div>
        <Terminal className="size-3.5 opacity-60" />
        <span className="text-xs font-medium opacity-80">{t('runs.runLog.logRun')}{runId}</span>
        {active && (
          <span className="flex items-center gap-1.5 rounded-full bg-sky-400/15 px-2 py-0.5 text-[11px] font-medium text-sky-300">
            <span className="size-1.5 animate-pulse rounded-full bg-sky-400" /> {t('runs.runLog.live')}
          </span>
        )}
        <span className="text-[11px] opacity-50">{lines.length} {t('runs.runLog.lines', { count: lines.length })}</span>
        {counts.warn > 0 && <span className="text-[11px] text-amber-300">{counts.warn} {t('runs.runLog.warnings', { count: counts.warn })}</span>}
        {counts.error > 0 && <span className="text-[11px] text-rose-400">{counts.error} {t('runs.runLog.errors', { count: counts.error })}</span>}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 opacity-50" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t('runs.runLog.filter')}
              aria-label={t('runs.runLog.filterLog')}
              className="h-7 w-40 rounded-md border border-white/10 bg-white/5 pr-2 pl-7 text-xs text-terminal-foreground outline-none placeholder:text-white/35 focus:border-white/25"
            />
          </div>
          <button
            type="button"
            onClick={() => setLevel((l) => (l === 'all' ? 'problems' : 'all'))}
            aria-pressed={level === 'problems'}
            className={cn('h-7 rounded-md border border-white/10 px-2 text-[11px] transition-colors hover:bg-white/10', level === 'problems' && 'border-amber-300/40 bg-amber-300/10 text-amber-200')}
          >
            {t('runs.runLog.problemsOnly')}
          </button>
          <TermButton label={wrap ? t('runs.runLog.wrapOff') : t('runs.runLog.wrapOn')} onClick={() => setWrap((w) => !w)} active={wrap}><WrapText /></TermButton>
          <TermButton label={t('runs.runLog.copy')} onClick={() => navigator.clipboard.writeText(asText()).then(() => toast.success(t('runs.runLog.logCopied')))}><Copy /></TermButton>
          <TermButton
            label={t('runs.runLog.download')}
            onClick={() => {
              const url = URL.createObjectURL(new Blob([asText()], { type: 'text/plain' }))
              const a = document.createElement('a')
              a.href = url
              a.download = `lauf-${runId}.log`
              a.click()
              URL.revokeObjectURL(url)
            }}
          >
            <Download />
          </TermButton>
          <label className="ml-1 flex cursor-pointer items-center gap-1.5 text-[11px] opacity-80">
            <Switch checked={follow} onCheckedChange={setFollow} className="h-4 w-7 data-[state=unchecked]:bg-white/20 [&>span]:size-3 [&>span]:data-[state=checked]:translate-x-3" aria-label={t('runs.runLog.followAutomatically')} />
            {t('runs.runLog.follow')}
          </label>
        </div>
      </div>
      <div className="relative">
        <div
          ref={scroller}
          onScroll={onScroll}
          className="h-[min(62vh,640px)] overflow-auto px-0 py-2 font-mono text-[12px] leading-[1.6]"
          role="log"
          aria-live={active && follow ? 'polite' : 'off'}
          aria-label={t('runs.runLog.runLog')}
        >
          {!loaded ? (
            <p className="px-4 text-white/40">{t('runs.runLog.loadingLog')}</p>
          ) : shown.length === 0 ? (
            <p className="px-4 text-white/40">{lines.length === 0 ? (active ? t('runs.runLog.waitingForOutput') : emptyText ?? t('runs.runLog.noOutputAvailable')) : t('runs.runLog.noLinesMatchTheFilter')}</p>
          ) : (
            shown.map((l) => (
              <div key={l.seq} className={cn('group flex gap-3 px-4 hover:bg-white/[0.04]', l.level === 'error' && 'bg-rose-500/[0.07]')}>
                <span className="w-16 shrink-0 text-white/30 select-none tabular">{formatTime(l.at)}</span>
                <span className={cn('min-w-0 flex-1', wrap ? 'break-words whitespace-pre-wrap' : 'whitespace-pre', levelClass[l.level], l.stream === 'system' && 'text-sky-300 italic', l.stream === 'stderr' && l.level === 'info' && 'text-rose-300')}>
                  {l.text || ' '}
                </span>
              </div>
            ))
          )}
          {active && loaded && <div className="px-4 pt-1"><span className="inline-block h-3.5 w-1.5 animate-pulse bg-terminal-foreground/70 align-middle" /></div>}
        </div>
        {!follow && lines.length > 0 && (
          <Button
            size="xs"
            variant="secondary"
            className="absolute right-4 bottom-4 shadow-lg"
            onClick={() => setFollow(true)}
          >
            <ArrowDownToLine /> {t('runs.runLog.toTheEnd')}
          </Button>
        )}
      </div>
    </div>
  )
}

function TermButton({ label, onClick, children, active }: { label: string; onClick: () => void; children: React.ReactNode; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn('grid size-7 place-content-center rounded-md border border-white/10 opacity-80 transition-colors hover:bg-white/10 hover:opacity-100 [&_svg]:size-3.5', active && 'bg-white/10')}
    >
      {children}
    </button>
  )
}
