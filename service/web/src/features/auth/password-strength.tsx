import { cn } from '@/lib/utils'
import { t } from '@/i18n'

export function scorePassword(pw: string): number {
  if (!pw) return 0
  let score = 0
  if (pw.length >= 12) score++
  if (pw.length >= 16) score++
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length
  if (classes >= 3) score++
  if (classes === 4 && pw.length >= 14) score++
  if (/(.)\1{2,}/.test(pw) || /^(password|passwort|123456|qwertz|qwerty)/i.test(pw)) score = Math.max(0, score - 1)
  if (pw.length < 12) score = Math.min(score, 1)
  return Math.min(4, score)
}

const labels = [t('auth.passwordStrength.veryWeak'), t('auth.passwordStrength.weak'), t('auth.passwordStrength.medium'), t('auth.passwordStrength.strong'), t('auth.passwordStrength.veryStrong')]
const colors = ['bg-rose-500', 'bg-rose-500', 'bg-amber-500', 'bg-emerald-500', 'bg-emerald-500']

export function PasswordStrength({ password }: { password: string }) {
  const s = scorePassword(password)
  return (
    <div className="grid gap-1.5" aria-live="polite">
      <div className="grid grid-cols-4 gap-1" aria-hidden>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className={cn('h-1 rounded-full bg-muted transition-colors duration-300', password && s >= i && colors[s])} />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {password ? (
          <>{t('auth.passwordStrength.passwordStrength')} <span className="font-medium text-foreground">{labels[s]}</span></>
        ) : (
          t('auth.passwordStrength.atLeast12CharactersTip')
        )}
      </p>
    </div>
  )
}

/** Generates a random password satisfying typical AD complexity rules. */
export function generatePassword(length = 20): string {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!#$%&*+-=?@_']
  const all = sets.join('')
  const rnd = (n: number) => {
    const a = new Uint32Array(1)
    crypto.getRandomValues(a)
    return a[0] % n
  }
  const chars = sets.map((s) => s[rnd(s.length)])
  while (chars.length < length) chars.push(all[rnd(all.length)])
  for (let i = chars.length - 1; i > 0; i--) {
    const j = rnd(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}
