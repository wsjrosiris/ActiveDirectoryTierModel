import { useNavigate } from 'react-router'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatDateShort } from '@/lib/utils'
import { t } from '@/i18n'

interface Point {
  runId: number
  at: string
  driftCount: number
}

export default function DriftChart({ data }: { data: Point[] }) {
  const navigate = useNavigate()
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart
        data={data}
        margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
        onClick={(s) => {
          const idx = typeof s?.activeTooltipIndex === 'number' ? s.activeTooltipIndex : Number(s?.activeTooltipIndex)
          const p = Number.isFinite(idx) ? data[idx] : undefined
          if (p) navigate(`/laeufe/${p.runId}`)
        }}
        style={{ cursor: 'pointer' }}
        accessibilityLayer
      >
        <defs>
          <linearGradient id="driftFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.28} />
            <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--color-border)" strokeDasharray="3 3" />
        <XAxis
          dataKey="at"
          tickFormatter={(v: string) => new Date(v).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}
          tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }}
          axisLine={false}
          tickLine={false}
          minTickGap={24}
        />
        <YAxis
          allowDecimals={false}
          width={32}
          tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          cursor={{ stroke: 'var(--color-muted-foreground)', strokeWidth: 1, strokeDasharray: '3 3' }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            const p = payload[0].payload as Point
            return (
              <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-lg">
                <p className="font-medium text-foreground">{t('dashboard.driftChart.audit')}{p.runId}</p>
                <p className="text-muted-foreground">{formatDateShort(p.at)}</p>
                <p className="mt-1 flex items-center gap-1.5 text-foreground">
                  <span className="size-2 rounded-full bg-primary" />
                  {p.driftCount === 0 ? t('dashboard.driftChart.noDrift') : t('dashboard.driftChart.driftcountDeviations', { driftCount: p.driftCount })}
                </p>
              </div>
            )
          }}
        />
        <Area
          type="monotone"
          dataKey="driftCount"
          name="Abweichungen"
          stroke="var(--color-primary)"
          strokeWidth={2}
          fill="url(#driftFill)"
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--color-card)' }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
