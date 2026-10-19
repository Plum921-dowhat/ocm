import { ApiError } from '../types/api'

export interface LoginFailure {
  /** Localized headline. States only a cause the response actually proves. */
  title: string
  /** Optional localized detail / next step. Never a raw server string. */
  description?: string
}

type Translate = (key: string, options?: Record<string, unknown>) => string

// describeLoginFailure maps a failed sign-in attempt to localized copy.
//
// The rule this module exists to enforce: the message may only name a cause
// the response proves. The previous UI hard-coded "账号或密码输入错误" as the
// headline while putting the raw server text underneath, so a 500 or a
// dropped connection still read as "wrong password" — the text and the cause
// disagreed. Every branch below derives both lines from the same evidence
// (HTTP status), and unknown failures get a neutral headline instead of a
// guessed one.
export function describeLoginFailure(err: unknown, t: Translate): LoginFailure {
  if (err instanceof ApiError) {
    // 401 is the only status the backend uses for "credentials rejected"
    // (internal/auth/handler.go). 400 is a malformed request, which the form
    // prevents client-side but still needs a truthful label.
    if (err.status === 401) {
      return {
        title: t('error.credentials'),
        description: t('error.credentialsHint'),
      }
    }
    if (err.status === 400) {
      return { title: t('error.badRequest') }
    }
    if (err.status === 429) {
      return { title: t('error.rateLimited') }
    }
    if (err.status >= 500) {
      return {
        title: t('error.title'),
        description: t('error.server', { status: err.status }),
      }
    }
    return {
      title: t('error.title'),
      description: t('error.requestFailed', { status: err.status }),
    }
  }

  // No HTTP status at all means fetch() never got a response: unreachable
  // server, DNS failure, or an aborted connection.
  return { title: t('error.title'), description: t('error.network') }
}
