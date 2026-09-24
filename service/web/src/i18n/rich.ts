import { createElement, Fragment, type ReactNode } from 'react'

/**
 * Renders a translated sentence that contains React elements: `[[name]]` markers in the text are replaced by
 * `nodes[name]`, so word order can differ per language, e.g.
 * `rich(t('jit.jitRequests.decision', { minutes }), { account: <code>{a}</code> })`.
 */
export function rich(text: string, nodes: Record<string, ReactNode>): ReactNode {
  const parts = text.split(/\[\[(\w+)\]\]/)
  return createElement(Fragment, null, ...parts.map((p, i) => (i % 2 ? (nodes[p] ?? null) : p)))
}
