import * as React from 'react'

/** Parses combos like "mod+k", "mod+shift+p", "mod+z", "/" ("mod" = Ctrl or ⌘). */
function matches(e: KeyboardEvent, combo: string) {
  const parts = combo.toLowerCase().split('+')
  const key = parts[parts.length - 1]
  const mod = parts.includes('mod')
  const shift = parts.includes('shift')
  const alt = parts.includes('alt')
  if (mod !== (e.ctrlKey || e.metaKey)) return false
  if (shift !== e.shiftKey) return false
  if (alt !== e.altKey) return false
  return e.key.toLowerCase() === key
}

export function isTypingTarget(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false
  if (el.isContentEditable || el.closest('.cm-editor')) return true
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

export function useHotkey(
  combos: string | string[],
  handler: (e: KeyboardEvent) => void,
  opts: { enabled?: boolean; allowInInputs?: boolean } = {},
) {
  const ref = React.useRef(handler)
  React.useEffect(() => {
    ref.current = handler
  })
  const list = Array.isArray(combos) ? combos : [combos]
  const key = list.join('|')
  React.useEffect(() => {
    if (opts.enabled === false) return
    const on = (e: KeyboardEvent) => {
      if (!opts.allowInInputs && isTypingTarget(e.target)) return
      if (key.split('|').some((c) => matches(e, c))) {
        e.preventDefault()
        ref.current(e)
      }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [key, opts.enabled, opts.allowInInputs])
}
