import 'i18next'
import type { de } from './de.ts'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: { translation: typeof de }
    returnNull: false
  }
}
