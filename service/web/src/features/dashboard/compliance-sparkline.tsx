import { Area, AreaChart, ResponsiveContainer, Tooltip, YAxis } from 'recharts'

interface Point {
  date: string
  score: number | null
}

const df = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })

/** 30-day history of one tier's compliance score (single series: no legend; hover shows the day's value). */
export default function ComplianceSparkline({ data, id }: { data: Point[]; id: string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 4, right: 2, bottom: 2, left: 2 }} accessibilityLayer>
        <defs>
          <linearGradient id={`cs-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.22} />
            <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <YAxis domain={[0, 100]} hide />
        <Tooltip
          cursor={{ stroke: 'var(--color-muted-foreground)', strokeWidth: 1, strokeDasharray: '3 3' }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            const p = payload[0].payload as Point
            return (
              <div className="rounded-lg border bg-popover px-2.5 py-1.5 text-xs shadow-lg">
                <p className="text-muted-foreground">{df.format(new Date(p.date))}</p>
                <p className="font-medium text-foreground">{p.score === null ? 'Keine Daten' : `${p.score} von 100`}</p>
              </div>
            )
          }}
        />
        <Area
          type="monotone"
          dataKey="score"
          stroke="var(--color-primary)"
          strokeWidth={2}
          fill={`url(#cs-${id})`}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--color-card)' }}
          connectNulls={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
