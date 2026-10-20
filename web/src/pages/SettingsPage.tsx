import { useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import {
  Alert,
  Breadcrumb,
  Button,
  Card,
  Divider,
  Input,
  InputNumber,
  Segmented,
  Select,
  Switch,
  Tag,
} from 'antd'
import { DesktopOutlined, MoonOutlined, SaveOutlined, SunOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthContext'
import { apiFetch } from '../auth/api'
import { THEME_CHOICES, useTheme, type ThemeChoice } from '../theme/ThemeContext'
import type { AiMaskedSettings, MailMaskedSettings, StorageMaskedSettings } from '../types/api'

// useSettings loads one settings endpoint into a form, saves via PUT, and
// re-applies the masked response over the form (so a stored secret shows as
// passwordSet rather than its value). The form carries the masked shape
// (Settings + the *Set secret marker), which the PUT body also sends — the
// backend decoder ignores the extra marker field.
function useSettings<T>(path: string, defaults: T, successText: string) {
  const { token } = useAuth()
  const [form, setForm] = useState<T>(defaults)
  const [baseline, setBaseline] = useState<T>(defaults)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    apiFetch<T>(path, { token })
      .then((data) => {
        const next = { ...defaults, ...data }
        setForm(next)
        setBaseline(next)
        setLoaded(true)
      })
      .catch((err: Error) => setError(err.message))
  }, [path, token])

  const save = () => {
    setSaving(true)
    setNotice('')
    setError('')
    apiFetch<T>(path, { method: 'PUT', body: form, token })
      .then((data) => {
        const next = { ...form, ...data }
        setForm(next)
        setBaseline(next)
        setNotice(successText)
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setSaving(false))
  }
  return {
    form,
    setForm: setForm as Dispatch<SetStateAction<T>>,
    loaded,
    saving,
    dirty: JSON.stringify(form) !== JSON.stringify(baseline),
    error,
    notice,
    save,
  }
}

// SettingsCard is the page's single building block: a titled panel with an
// optional enable switch, status chip, and a right-aligned save action. Keeping
// every section on this frame is what makes the page read as a console rather
// than a stack of unlabelled inputs.
function SettingsCard({
  title,
  hint,
  status,
  switchNode,
  children,
  footer,
}: {
  title: string
  hint: string
  status?: boolean
  switchNode?: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  const { t } = useTranslation('settings')
  return (
    <Card variant="outlined" className="settings-card">
      <div className="settings-card__head">
        <h2 className="settings-card__title">{title}</h2>
        {(status !== undefined || switchNode) && (
          <div className="settings-card__status">
            {status !== undefined && (
              <Tag color={status ? 'green' : 'default'} className="settings-card__tag">
                {status ? t('status.enabled') : t('status.disabled')}
              </Tag>
            )}
            {switchNode}
          </div>
        )}
      </div>
      <p className="settings-card__hint">{hint}</p>
      <Divider className="settings-card__divider" />
      <div className="settings-card__body">{children}</div>
      {footer && <div className="settings-card__footer">{footer}</div>}
    </Card>
  )
}

// SettingsRow is the label-left / control-right form row used inside a card.
// It replaces the old stacked Field rows, which stretched inputs to the full
// column width and made every section look unfinished.
function SettingsRow({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string
  hint?: string
  htmlFor?: string
  children: ReactNode
}) {
  return (
    <div className="settings-row">
      <div className="settings-row__label">
        <label htmlFor={htmlFor}>{label}</label>
        {hint && <span className="settings-row__hint">{hint}</span>}
      </div>
      <div className="settings-row__control">{children}</div>
    </div>
  )
}

function SaveBar({ blocked, saving, disabled, dirty, onSave }: {
  blocked: boolean
  saving: boolean
  disabled: boolean
  dirty: boolean
  onSave: () => void
}) {
  const { t } = useTranslation('settings')
  if (disabled) return null
  return (
    <div className="settings-card__save">
      <span className="settings-card__save-state">
        {dirty ? t('unsavedHint') : t('savedHint')}
      </span>
      <Button
        type="primary"
        icon={<SaveOutlined />}
        loading={saving}
        disabled={blocked || !dirty}
        onClick={onSave}
      >
        {t('saveButton')}
      </Button>
    </div>
  )
}

// Appearance is a client-side preference (localStorage), unlike the server
// settings sections below, so it applies instantly and is available to every
// user - not just admins.
function AppearanceSection() {
  const { t } = useTranslation('settings')
  const { preference, setPreference } = useTheme()

  return (
    <SettingsCard title={t('appearance.heading')} hint={t('appearance.hint')}>
      <SettingsRow label={t('appearance.label')} htmlFor="theme-preference">
        <Segmented
          id="theme-preference"
          value={preference}
          onChange={(value) => setPreference(value as ThemeChoice)}
          options={[
            { value: 'system', label: t('theme.system', { ns: 'common' }), icon: <DesktopOutlined /> },
            { value: 'g10', label: t('theme.light', { ns: 'common' }), icon: <SunOutlined /> },
            { value: 'g100', label: t('theme.dark', { ns: 'common' }), icon: <MoonOutlined /> },
          ]}
        />
      </SettingsRow>
    </SettingsCard>
  )
}

const MAIL_DEFAULTS: MailMaskedSettings = {
  enabled: false,
  host: '',
  port: 465,
  username: '',
  password: '',
  passwordSet: false,
  fromName: '',
  fromAddress: '',
  encryption: 'ssl',
}

const MAIL_ENCRYPTION_OPTIONS = [
  { value: 'ssl', labelKey: 'mail.encryptionSsl' },
  { value: 'starttls', labelKey: 'mail.encryptionStarttls' },
  { value: 'none', labelKey: 'mail.encryptionNone' },
] as const

function MailSection({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation('settings')
  const s = useSettings<MailMaskedSettings>('/api/settings/email', MAIL_DEFAULTS, t('mail.savedNotice'))
  const { form, setForm } = s
  // Mirrors the server-side validation for enabled services so the save
  // button stays disabled on invalid input.
  const valid =
    !form.enabled ||
    (form.host.trim() !== '' &&
      form.username.trim() !== '' &&
      form.fromAddress.trim() !== '' &&
      form.fromAddress.includes('@') &&
      form.port >= 1 &&
      form.port <= 65535)

  return (
    <SettingsCard
      title={t('mail.heading')}
      hint={t('mail.hint')}
      status={form.enabled}
      switchNode={
        <Switch
          aria-label={t('mail.enabledLabel')}
          checked={form.enabled}
          disabled={disabled || !s.loaded}
          onChange={(checked) => setForm({ ...form, enabled: checked })}
        />
      }
      footer={
        <SaveBar blocked={!valid} saving={s.saving} disabled={disabled} dirty={s.dirty} onSave={s.save} />
      }
    >
      {s.error && <Alert type="error" showIcon title={t('error.action')} description={s.error} />}
      {s.notice && <Alert type="success" showIcon title={s.notice} />}
      <SettingsRow label={t('mail.host')} htmlFor="mail-host">
        <Input
          id="mail-host"
          placeholder="smtp.example.com"
          value={form.host}
          disabled={disabled || !s.loaded}
          onChange={(e) => setForm({ ...form, host: e.target.value })}
        />
      </SettingsRow>
      <SettingsRow label={t('mail.port')} htmlFor="mail-port" hint={t('mail.portHint')}>
        <InputNumber
          id="mail-port"
          min={1}
          max={65535}
          value={form.port}
          disabled={disabled || !s.loaded}
          onChange={(value) => setForm({ ...form, port: Number(value) })}
        />
      </SettingsRow>
      <SettingsRow label={t('mail.username')} htmlFor="mail-username">
        <Input
          id="mail-username"
          value={form.username}
          disabled={disabled || !s.loaded}
          onChange={(e) => setForm({ ...form, username: e.target.value })}
        />
      </SettingsRow>
      <SettingsRow label={t('mail.password')} htmlFor="mail-password" hint={t('mail.passwordHint')}>
        <Input.Password
          id="mail-password"
          placeholder={form.passwordSet ? t('placeholder.set') : t('placeholder.unset')}
          value={form.password}
          disabled={disabled || !s.loaded}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
      </SettingsRow>
      <SettingsRow label={t('mail.fromName')} htmlFor="mail-from-name">
        <Input
          id="mail-from-name"
          placeholder={t('mail.fromNamePlaceholder')}
          value={form.fromName}
          disabled={disabled || !s.loaded}
          onChange={(e) => setForm({ ...form, fromName: e.target.value })}
        />
      </SettingsRow>
      <SettingsRow label={t('mail.fromAddress')} htmlFor="mail-from-address">
        <Input
          id="mail-from-address"
          placeholder="notify@example.com"
          value={form.fromAddress}
          disabled={disabled || !s.loaded}
          onChange={(e) => setForm({ ...form, fromAddress: e.target.value })}
        />
      </SettingsRow>
      <SettingsRow label={t('mail.encryption')} htmlFor="mail-encryption">
        <Select
          id="mail-encryption"
          value={form.encryption}
          disabled={disabled || !s.loaded}
          onChange={(value) => setForm({ ...form, encryption: value })}
          options={MAIL_ENCRYPTION_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
        />
      </SettingsRow>
    </SettingsCard>
  )
}

const STORAGE_DEFAULTS: StorageMaskedSettings = {
  enabled: false,
  endpoint: '',
  region: '',
  bucket: '',
  accessKey: '',
  secretKey: '',
  secretKeySet: false,
  useSsl: true,
  usePathStyle: true,
  publicBaseUrl: '',
}

function StorageSection({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation('settings')
  const s = useSettings<StorageMaskedSettings>('/api/settings/storage', STORAGE_DEFAULTS, t('storage.savedNotice'))
  const { form, setForm } = s
  // Mirrors the server-side validation for enabled services so the save
  // button stays disabled on invalid input.
  const valid =
    !form.enabled ||
    (form.endpoint.trim() !== '' &&
      !form.endpoint.includes('://') &&
      form.bucket.trim() !== '' &&
      form.accessKey.trim() !== '')

  return (
    <SettingsCard
      title={t('storage.heading')}
      hint={t('storage.hint')}
      status={form.enabled}
      switchNode={
        <Switch
          aria-label={t('storage.enabledLabel')}
          checked={form.enabled}
          disabled={disabled || !s.loaded}
          onChange={(checked) => setForm({ ...form, enabled: checked })}
        />
      }
      footer={
        <SaveBar blocked={!valid} saving={s.saving} disabled={disabled} dirty={s.dirty} onSave={s.save} />
      }
    >
      {s.error && <Alert type="error" showIcon title={t('error.action')} description={s.error} />}
      {s.notice && <Alert type="success" showIcon title={s.notice} />}
      <SettingsRow label={t('storage.endpoint')} htmlFor="storage-endpoint" hint={t('storage.endpointHint')}>
        <Input
          id="storage-endpoint"
          placeholder="cos.ap-guangzhou.myqcloud.com"
          value={form.endpoint}
          disabled={disabled || !s.loaded}
          onChange={(e) => setForm({ ...form, endpoint: e.target.value })}
        />
      </SettingsRow>
      <SettingsRow label={t('storage.region')} htmlFor="storage-region">
        <Input
          id="storage-region"
          placeholder="ap-guangzhou"
          value={form.region}
          disabled={disabled || !s.loaded}
          onChange={(e) => setForm({ ...form, region: e.target.value })}
        />
      </SettingsRow>
      <SettingsRow label={t('storage.bucket')} htmlFor="storage-bucket">
        <Input
          id="storage-bucket"
          value={form.bucket}
          disabled={disabled || !s.loaded}
          onChange={(e) => setForm({ ...form, bucket: e.target.value })}
        />
      </SettingsRow>
      <SettingsRow label={t('storage.accessKey')} htmlFor="storage-access-key">
        <Input
          id="storage-access-key"
          value={form.accessKey}
          disabled={disabled || !s.loaded}
          onChange={(e) => setForm({ ...form, accessKey: e.target.value })}
        />
      </SettingsRow>
      <SettingsRow label={t('storage.secretKey')} htmlFor="storage-secret-key">
        <Input.Password
          id="storage-secret-key"
          placeholder={form.secretKeySet ? t('placeholder.set') : t('placeholder.unset')}
          value={form.secretKey}
          disabled={disabled || !s.loaded}
          onChange={(e) => setForm({ ...form, secretKey: e.target.value })}
        />
      </SettingsRow>
      <SettingsRow label={t('storage.publicBaseUrl')} htmlFor="storage-public-base-url" hint={t('storage.publicBaseUrlHint')}>
        <Input
          id="storage-public-base-url"
          placeholder="https://cdn.example.com"
          value={form.publicBaseUrl}
          disabled={disabled || !s.loaded}
          onChange={(e) => setForm({ ...form, publicBaseUrl: e.target.value })}
        />
      </SettingsRow>
      <SettingsRow label={t('storage.useSsl')} htmlFor="storage-use-ssl" hint={t('storage.useSslHint')}>
        <Switch
          id="storage-use-ssl"
          checked={form.useSsl}
          disabled={disabled || !s.loaded}
          onChange={(checked) => setForm({ ...form, useSsl: checked })}
        />
      </SettingsRow>
      <SettingsRow label={t('storage.usePathStyle')} htmlFor="storage-use-path-style" hint={t('storage.usePathStyleHint')}>
        <Switch
          id="storage-use-path-style"
          checked={form.usePathStyle}
          disabled={disabled || !s.loaded}
          onChange={(checked) => setForm({ ...form, usePathStyle: checked })}
        />
      </SettingsRow>
    </SettingsCard>
  )
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

const AI_DEFAULTS: AiMaskedSettings = {
  enabled: false,
  baseUrl: '',
  model: '',
  apiKey: '',
  apiKeySet: false,
}

function AiSection({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation('settings')
  const s = useSettings<AiMaskedSettings>('/api/settings/ai', AI_DEFAULTS, t('ai.savedNotice'))
  const { form, setForm } = s
  // Mirrors the server-side validation for enabled services so the save
  // button stays disabled on invalid input.
  const valid =
    !form.enabled ||
    (isHttpUrl(form.baseUrl.trim()) &&
      form.model.trim() !== '' &&
      (form.apiKey.trim() !== '' || form.apiKeySet))

  return (
    <SettingsCard
      title={t('ai.heading')}
      hint={t('ai.hint')}
      status={form.enabled}
      switchNode={
        <Switch
          aria-label={t('ai.enabledLabel')}
          checked={form.enabled}
          disabled={disabled || !s.loaded}
          onChange={(checked) => setForm({ ...form, enabled: checked })}
        />
      }
      footer={
        <SaveBar blocked={!valid} saving={s.saving} disabled={disabled} dirty={s.dirty} onSave={s.save} />
      }
    >
      {s.error && <Alert type="error" showIcon title={t('error.action')} description={s.error} />}
      {s.notice && <Alert type="success" showIcon title={s.notice} />}
      <SettingsRow label={t('ai.baseUrl')} htmlFor="ai-base-url">
        <Input
          id="ai-base-url"
          placeholder="https://api.openai.com/v1"
          value={form.baseUrl}
          disabled={disabled || !s.loaded}
          onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
        />
      </SettingsRow>
      <SettingsRow label={t('ai.model')} htmlFor="ai-model">
        <Input
          id="ai-model"
          placeholder="gpt-4o-mini"
          value={form.model}
          disabled={disabled || !s.loaded}
          onChange={(e) => setForm({ ...form, model: e.target.value })}
        />
      </SettingsRow>
      <SettingsRow label={t('ai.apiKey')} htmlFor="ai-api-key" hint={t('ai.apiKeyHint')}>
        <Input.Password
          id="ai-api-key"
          placeholder={form.apiKeySet ? t('placeholder.set') : t('placeholder.unset')}
          value={form.apiKey}
          disabled={disabled || !s.loaded}
          onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
        />
      </SettingsRow>
    </SettingsCard>
  )
}

export default function SettingsPage() {
  const { t } = useTranslation('settings')
  const { can } = useAuth()
  const navigate = useNavigate()
  const isAdmin = can('*')

  return (
    <div className="settings-page">
      <Breadcrumb
        aria-label={t('aria.breadcrumb', { ns: 'common' })}
        items={[
          {
            title: (
              <a
                href="/"
                onClick={(e) => {
                  e.preventDefault()
                  navigate('/')
                }}
              >
                {t('breadcrumb.home')}
              </a>
            ),
          },
          { title: t('breadcrumb.current') },
        ]}
      />
      <header className="settings-page__header">
        <div>
          <h1 className="settings-page__heading">{t('title')}</h1>
          <p className="settings-page__subtitle">{t('subtitle')}</p>
        </div>
        {!isAdmin && <Tag className="settings-page__readonly">{t('readonlyBadge')}</Tag>}
      </header>

      <div className="settings-stack">
        <AppearanceSection />
        <MailSection disabled={!isAdmin} />
        <StorageSection disabled={!isAdmin} />
        <AiSection disabled={!isAdmin} />
      </div>
    </div>
  )
}
