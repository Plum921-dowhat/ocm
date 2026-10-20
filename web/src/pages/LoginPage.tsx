import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Alert, Button, Checkbox, Dropdown, Input, Select, type InputRef } from 'antd'
import {
  ArrowRightOutlined,
  EditOutlined,
  FileTextOutlined,
  TranslationOutlined,
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthContext'
import { describeLoginFailure, type LoginFailure } from '../auth/loginError'
import useLanguage from '../i18n/useLanguage'
import logoUrl from '../assets/logo.png'
import wechatIconUrl from '../assets/wechat-icon.png'

// Inlined at build/dev-server time from the VITE_ICP_NUMBER env var.
// Empty means no ICP footer is rendered and the page stays unchanged.
const icp = import.meta.env.VITE_ICP_NUMBER || ''
// External docs site; when unset the Docs nav link is hidden.
const docsUrl = import.meta.env.VITE_DOCS_URL || ''
const REMEMBER_KEY = 'ocm.remembered-id'

const displayOnly = (event: MouseEvent) => event.preventDefault()

// Sign-in realm options for the two-step form's leading select.
const REALM_KEYS = ['email'] as const

function WeChatIcon({ className }: { className?: string }) {
  return (
    <img
      src={wechatIconUrl}
      alt=""
      aria-hidden="true"
      className={className}
      style={{ display: 'block', height: '20px', width: '20px', objectFit: 'contain' }}
    />
  )
}

// Two-step sign-in: 'id' collects the account, 'password' unlocks it.
type Step = 'id' | 'password'

export default function LoginPage() {
  const { t } = useTranslation('login')
  const { languages, setLanguage, language } = useLanguage()
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [step, setStep] = useState<Step>('id')
  const [realm, setRealm] = useState<string>('email')
  const [username, setUsername] = useState(() => localStorage.getItem(REMEMBER_KEY) || '')
  const [password, setPassword] = useState('')
  const [rememberId, setRememberId] = useState(() => Boolean(localStorage.getItem(REMEMBER_KEY)))
  const [idError, setIdError] = useState('')
  const [passwordError, setPasswordError] = useState('')
  // Server-side failures are a single structured value (headline + detail
  // derived from the same HTTP status) instead of a bare string rendered next
  // to a hard-coded headline - that split is what let the text and the cause
  // disagree. See auth/loginError.ts.
  const [formError, setFormError] = useState<LoginFailure | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const passwordRef = useRef<InputRef>(null)
  useEffect(() => {
    if (step === 'password') {
      passwordRef.current?.focus()
    }
  }, [step])

  if (user) {
    return <Navigate to="/" replace />
  }

  const handleContinue = (event: FormEvent) => {
    event.preventDefault()
    // One attempt may show at most one error: clear the previous attempt's
    // server failure and field error before validating this one.
    setFormError(null)
    setIdError('')
    if (!username.trim()) {
      setIdError(t('enterId'))
      return
    }
    setStep('password')
  }

  const handleBackToId = () => {
    setFormError(null)
    setPasswordError('')
    setIdError('')
    setStep('id')
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (submitting) return
    // Same rule as handleContinue: a new submit discards the old failure
    // before it can be shown next to the new one.
    setFormError(null)
    setPasswordError('')
    if (!password) {
      setPasswordError(t('enterPassword'))
      return
    }
    setSubmitting(true)
    try {
      if (rememberId) {
        localStorage.setItem(REMEMBER_KEY, username.trim())
      } else {
        localStorage.removeItem(REMEMBER_KEY)
      }
      await login(username.trim(), password)
      const state = location.state as { from?: { pathname?: string } } | null
      const target = state?.from?.pathname || '/'
      navigate(target, { replace: true })
    } catch (err) {
      // Keep the raw cause for debugging, but only render copy that matches
      // the status the server actually returned.
      console.error('[login] sign-in failed:', err)
      setFormError(describeLoginFailure(err, t))
    } finally {
      setSubmitting(false)
    }
  }

  const langMenu = {
    items: languages.map((lng) => ({ key: lng, label: t(`language.${lng}`, { ns: 'common' }) })),
    selectedKeys: [language],
    onClick: ({ key }: { key: string }) => setLanguage(key as never),
  }

  return (
    <div className="login">
      <header className="login__header">
        <a href="#" className="login__brand" onClick={displayOnly}>
          <span className="login__brand-name">{t('brand')}</span>
        </a>
        <nav className="login__nav" aria-label={t('docs')}>
          {docsUrl && (
            <a href={docsUrl} className="login__nav-item" target="_blank" rel="noreferrer">
              <span className="login__nav-icon"><FileTextOutlined /></span>
              <span className="login__nav-text">{t('docs')}</span>
            </a>
          )}
          <Dropdown menu={langMenu} trigger={['click']} placement="bottomRight">
            <button
              type="button"
              className="login__nav-item login__lang"
              aria-label={t('aria.languageSwitcher', { ns: 'common' })}
            >
              <TranslationOutlined />
            </button>
          </Dropdown>
        </nav>
      </header>

      <div className="login__container">
        <div className="login__panel">
          <div className="login__panel-main">
            <img src={logoUrl} className="login__logo" alt="" aria-hidden="true" />
            <h1 className="login__title">
              {t('titlePrefix')}
              <span className="login__title-cloud">{t('titleCloud')}</span>
            </h1>
            <p className="login__create-account">
              {t('createAccountPrefix')}{' '}
              <a href="#" onClick={displayOnly}>{t('createAccountLink')}</a>
            </p>

            <div className="login__rows">
              <form
                className={`login__id-row${step === 'password' ? ' login__id-row--out' : ''}`}
                onSubmit={handleContinue}
                noValidate
                aria-hidden={step === 'password'}
              >
                <div className="login__label">{t('signInWith')}</div>
                <div className="login__id-inputs">
                  <div className="login__realm">
                    <Select
                      id="realm"
                      aria-label={t('signInWith')}
                      value={realm}
                      onChange={setRealm}
                      size="large"
                      options={REALM_KEYS.map((key) => ({ value: key, label: t(key) }))}
                    />
                  </div>
                  <div className="login__userid">
                    <Input
                      id="userid"
                      aria-label={t('email')}
                      placeholder={t('usernamePlaceholder')}
                      value={username}
                      onChange={(e) => {
                        setUsername(e.target.value)
                        if (idError) setIdError('')
                        // A new attempt invalidates the previous failure.
                        if (formError) setFormError(null)
                      }}
                      status={idError ? 'error' : undefined}
                      autoComplete="username"
                      size="large"
                      autoFocus
                      tabIndex={step === 'password' ? -1 : 0}
                    />
                    {idError && <div className="login__field-error" role="alert">{idError}</div>}
                  </div>
                </div>
                <div className="login__button-row">
                  <Button
                    htmlType="submit"
                    type="primary"
                    size="large"
                    className="login__primary-btn"
                    icon={<ArrowRightOutlined />}
                    iconPlacement="end"
                  >
                    {t('continue')}
                  </Button>
                </div>
                <div className="login__aux">
                  <a href="#" className="login__link" onClick={displayOnly} tabIndex={step === 'password' ? -1 : 0}>
                    {t('forgotId')}
                  </a>
                  <Checkbox
                    id="remember-id"
                    checked={rememberId}
                    onChange={(e) => setRememberId(e.target.checked)}
                    tabIndex={step === 'password' ? -1 : 0}
                  >
                    {t('rememberId')}
                  </Checkbox>
                </div>
                <div className="login__separator">{t('or')}</div>
                <Button
                  size="large"
                  className="login__sso-btn"
                  icon={<WeChatIcon />}
                  onClick={displayOnly}
                  tabIndex={step === 'password' ? -1 : 0}
                >
                  {t('continueWithWeChat')}
                </Button>
              </form>

              <form
                className={`login__password-row${step === 'password' ? ' login__password-row--in' : ''}`}
                onSubmit={handleSubmit}
                noValidate
                aria-hidden={step === 'id'}
              >
                {formError && (
                  <Alert
                    type="error"
                    showIcon
                    title={formError.title}
                    description={formError.description}
                    className="login__error"
                    closable={{ onClose: () => setFormError(null) }}
                  />
                )}
                <button type="button" className="login__id-display" onClick={handleBackToId}>
                  <EditOutlined />
                  <span>{username}</span>
                </button>
                <div className="login__password-field">
                  <Input.Password
                    id="password"
                    aria-label={t('password')}
                    placeholder={t('passwordPlaceholder')}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value)
                      if (passwordError) setPasswordError('')
                      if (formError) setFormError(null)
                    }}
                    status={passwordError ? 'error' : undefined}
                    autoComplete="current-password"
                    size="large"
                    ref={passwordRef}
                    tabIndex={step === 'id' ? -1 : 0}
                  />
                  {passwordError && <div className="login__field-error" role="alert">{passwordError}</div>}
                </div>
                <div className="login__button-row">
                  <Button
                    htmlType="submit"
                    type="primary"
                    size="large"
                    className="login__primary-btn"
                    icon={<ArrowRightOutlined />}
                    iconPlacement="end"
                    disabled={submitting}
                  >
                    {submitting ? t('loggingIn') : t('logIn')}
                  </Button>
                </div>
                <div className="login__aux login__aux--password">
                  <a href="#" className="login__link" onClick={displayOnly} tabIndex={step === 'id' ? -1 : 0}>
                    {t('forgotPassword')}
                  </a>
                </div>
              </form>
            </div>
          </div>

          <div className="login__copyright">
            {icp && (
              <>
                {' '}
                <a href="https://beian.miit.gov.cn" target="_blank" rel="noreferrer">
                  {icp}
                </a>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
