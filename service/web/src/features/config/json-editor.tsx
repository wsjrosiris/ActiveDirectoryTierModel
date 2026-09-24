import * as React from 'react'
import CodeMirror, { EditorView, type ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { json, jsonParseLinter } from '@codemirror/lang-json'
import { linter, lintGutter } from '@codemirror/lint'
import { AlertCircle, CheckCircle2, WrapText } from 'lucide-react'
import { useTheme } from '@/lib/theme'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

function describeError(text: string): string | null {
  try {
    JSON.parse(text)
    return null
  } catch (e) {
    const msg = (e as Error).message
    const m = /position (\d+)/.exec(msg)
    if (m) {
      const pos = Number(m[1])
      const before = text.slice(0, pos)
      const line = before.split('\n').length
      const col = pos - before.lastIndexOf('\n')
      return `${msg.replace(/ in JSON at position \d+.*$/, '')} (Zeile ${line}, Spalte ${col})`
    }
    return msg
  }
}

const baseTheme = EditorView.theme({
  '&': { backgroundColor: 'transparent' },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    borderRight: '1px solid var(--color-border)',
    color: 'var(--color-muted-foreground)',
  },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--color-foreground)' },
  '.cm-content': { padding: '8px 0' },
})

export default function JsonEditor({
  value,
  onChange,
  readOnly,
  height = '60vh',
}: {
  value: Json
  onChange: (v: Json) => void
  readOnly?: boolean
  height?: string
}) {
  const { resolved } = useTheme()
  const ref = React.useRef<ReactCodeMirrorRef>(null)
  const lastEmitted = React.useRef<Json>(value)
  const [text, setText] = React.useState(() => JSON.stringify(value ?? {}, null, 2))
  const [error, setError] = React.useState<string | null>(null)

  // External change (undo/redo, restore, reload) → replace text.
  React.useEffect(() => {
    if (value !== lastEmitted.current) {
      lastEmitted.current = value
      setText(JSON.stringify(value ?? {}, null, 2))
      setError(null)
    }
  }, [value])

  const handleChange = React.useCallback(
    (t: string) => {
      setText(t)
      const err = describeError(t)
      setError(err)
      if (!err) {
        const parsed = JSON.parse(t)
        lastEmitted.current = parsed
        onChange(parsed)
      }
    },
    [onChange],
  )

  const format = () => {
    try {
      const parsed = JSON.parse(text)
      const formatted = JSON.stringify(parsed, null, 2)
      setText(formatted)
      lastEmitted.current = parsed
      onChange(parsed)
    } catch {
      /* invalid json cannot be formatted */
    }
  }

  const extensions = React.useMemo(
    () => [json(), linter(jsonParseLinter(), { delay: 300 }), lintGutter(), baseTheme, EditorView.lineWrapping],
    [],
  )

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-[0_1px_2px_0_rgb(0_0_0/0.03)]">
      <div className="flex items-center justify-between gap-3 border-b bg-muted/30 px-3 py-1.5">
        <div className={cn('flex min-w-0 items-center gap-1.5 text-xs', error ? 'text-destructive' : 'text-muted-foreground')} role="status" aria-live="polite">
          {error ? <AlertCircle className="size-3.5 shrink-0" /> : <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />}
          <span className="truncate">{error ? `Ungültiges JSON – ${error}` : 'Gültiges JSON'}</span>
        </div>
        {!readOnly && (
          <Button variant="ghost" size="xs" onClick={format} disabled={!!error}>
            <WrapText /> Formatieren
          </Button>
        )}
      </div>
      <CodeMirror
        ref={ref}
        value={text}
        onChange={handleChange}
        height={height}
        theme={resolved}
        readOnly={readOnly}
        editable={!readOnly}
        extensions={extensions}
        basicSetup={{ foldGutter: true, highlightActiveLine: !readOnly, autocompletion: false }}
        aria-label="JSON-Editor"
      />
    </div>
  )
}
