import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Avatar, Button, Drawer, Dropdown, Grid, Layout, Menu, Space, Tooltip, type MenuProps } from 'antd'
import {
  BellOutlined,
  BgColorsOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  TranslationOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthContext'
import useLanguage from '../i18n/useLanguage'
import { useTheme, type ThemePreference } from '../theme/ThemeContext'
import { navigation, type NavEntry, type PermissionGate } from '../config/navigation'

const AiChat = lazy(() => import('../ai/AiChat'))

const { Sider, Header, Content } = Layout

/** True when the subject holds at least one of the gated permissions. */
function passesGate(can: (perm: string) => boolean, gate?: PermissionGate): boolean {
  if (!gate) return true
  return Array.isArray(gate) ? gate.some((perm) => can(perm)) : can(gate)
}

/** i18n label with a literal-label fallback for downstream entries. */
function navLabel(t: (key: string) => string, entry: { i18nKey?: string; label?: string; path?: string }): string {
  if (entry.i18nKey) return t(entry.i18nKey)
  return entry.label ?? entry.path ?? ''
}

/** Every navigable path in the effective menu, for the selected-key lookup. */
function allPaths(entries: NavEntry[]): string[] {
  return entries.flatMap((entry) =>
    entry.kind === 'link' ? [entry.path] : entry.items.map((item) => item.path),
  )
}

// AppShell renders the Ant Design application frame (sider + header + content)
// shared by all authenticated pages. It persists across route changes via a
// React Router layout route so the menu never remounts.
//
// The migration away from Carbon's UI Shell is intentionally kept in this one
// file: pages receive the same children and the menu is still data-driven by
// src/config/navigation.ts, so downstream entries keep working unchanged.
export default function AppShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const { language, setLanguage, languages } = useLanguage()
  const { user, logout, can } = useAuth()
  const { preference, colorScheme, setPreference } = useTheme()
  const navigate = useNavigate()
  const location = useLocation()
  const screens = Grid.useBreakpoint()

  const isMobile = !screens.lg
  const [collapsed, setCollapsed] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const paths = useMemo(() => allPaths(navigation), [])
  const selectedKey = useMemo(() => {
    if (location.pathname === '/') return '/'
    const matches = paths
      .filter((p) => p !== '/' && (location.pathname === p || location.pathname.startsWith(`${p}/`)))
      .sort((a, b) => b.length - a.length)
    return matches[0] ?? ''
  }, [location.pathname, paths])

  const groupKeyOf = useMemo(() => {
    const map = new Map<string, string>()
    navigation.forEach((entry) => {
      if (entry.kind !== 'group') return
      const key = `group:${entry.i18nKey ?? entry.label ?? entry.items[0]?.path}`
      entry.items.forEach((item) => map.set(item.path, key))
    })
    return map
  }, [])

  const [openKeys, setOpenKeys] = useState<string[]>(() => {
    const key = groupKeyOf.get(selectedKey)
    return key ? [key] : []
  })

  // Keep the group holding the current page open when navigation happens
  // outside the menu (breadcrumb, dashboard shortcut, direct URL).
  useEffect(() => {
    const key = groupKeyOf.get(selectedKey)
    if (!key) return
    setOpenKeys((keys) => (keys.includes(key) ? keys : [...keys, key]))
  }, [groupKeyOf, selectedKey])

  // Close the mobile drawer after a navigation.
  useEffect(() => {
    setDrawerOpen(false)
  }, [location.pathname])

  const menuItems = useMemo<MenuProps['items']>(() => {
    const items: NonNullable<MenuProps['items']> = []
    navigation.forEach((entry) => {
      if (!passesGate(can, entry.permission)) return
      if (entry.kind === 'link') {
        const Icon = entry.icon
        items.push({
          key: entry.path,
          icon: Icon ? <Icon size={16} /> : undefined,
          label: navLabel(t, entry),
        })
        return
      }
      const children = entry.items
        .filter((item) => passesGate(can, item.permission))
        .map((item) => ({ key: item.path, label: navLabel(t, item) }))
      if (children.length === 0) return
      const Icon = entry.icon
      items.push({
        key: `group:${entry.i18nKey ?? entry.label ?? entry.items[0]?.path}`,
        icon: Icon ? <Icon size={16} /> : undefined,
        label: navLabel(t, entry),
        children,
      })
    })
    return items
  }, [can, t])

  const onMenuClick: MenuProps['onClick'] = ({ key }) => {
    if (key.startsWith('group:')) return
    if (key !== location.pathname) navigate(key)
  }

  const themeItems: MenuProps['items'] = [
    { key: 'system', label: t('theme.system') },
    { key: 'light', label: t('theme.light') },
    { key: 'dark', label: t('theme.dark') },
  ]

  // The stored preference still uses Carbon's four names (a user may have
  // picked one before the migration). Collapse them to three menu choices;
  // light picks g10 and dark picks g100 so already-migrated and not-yet-
  // migrated pages agree on the colour mode.
  const themeChoice: 'system' | 'light' | 'dark' =
    preference === 'system' ? 'system' : colorScheme === 'dark' ? 'dark' : 'light'

  const changeTheme = (key: string) => {
    if (key === 'system') setPreference('system')
    else setPreference((key === 'dark' ? 'g100' : 'g10') as ThemePreference)
  }

  const langItems: MenuProps['items'] = languages.map((lng) => ({
    key: lng,
    label: t(`language.${lng}`),
  }))

  const menu = (
    <Menu
      mode="inline"
      selectedKeys={selectedKey ? [selectedKey] : []}
      openKeys={openKeys}
      onOpenChange={(keys) => setOpenKeys(keys as string[])}
      onClick={onMenuClick}
      items={menuItems}
      className="app-shell__menu"
    />
  )

  const brand = (
    <div className="app-shell__brand">
      <span className="app-shell__brand-name">{t('app.title')}</span>
    </div>
  )

  return (
    <>
      <Layout className="app-shell" hasSider={!isMobile}>
      {!isMobile && (
        <Sider
          className="app-shell__sider"
          width={232}
          collapsedWidth={72}
          collapsed={collapsed}
          trigger={null}
          theme={colorScheme === 'dark' ? 'dark' : 'light'}
          style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'auto' }}
        >
          {brand}
          {menu}
        </Sider>
      )}

      {isMobile && (
        <Drawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          placement="left"
          size={264}
          closable={false}
          styles={{ body: { padding: 0 } }}
          className="app-shell__drawer"
        >
          {brand}
          {menu}
        </Drawer>
      )}

      <Layout>
        <Header className="app-shell__header">
          <Button
            type="text"
            className="app-shell__nav-toggle"
            aria-label={
              isMobile
                ? drawerOpen
                  ? t('aria.navToggleClose')
                  : t('aria.navToggleOpen')
                : collapsed
                  ? t('aria.navToggleOpen')
                  : t('aria.navToggleClose')
            }
            icon={collapsed && !isMobile ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            // Toggle, not "open": the label already flips to "close" while the
            // drawer is open, so the handler must actually close it. (The panel
            // covers this button today, but the label must not lie.)
            onClick={() => (isMobile ? setDrawerOpen((v) => !v) : setCollapsed((v) => !v))}
          />

          <div className="app-shell__header-spacer" />

          <Space size={2} className="app-shell__actions">
            <Tooltip title={t('aria.notification')} placement="bottom">
              <Button type="text" aria-label={t('aria.notification')} icon={<BellOutlined />} />
            </Tooltip>

            <Dropdown
              menu={{ items: langItems, selectedKeys: [language], onClick: ({ key }) => setLanguage(key as never) }}
              trigger={['click']}
              placement="bottomRight"
            >
              <Button type="text" aria-label={t('aria.languageSwitcher')} icon={<TranslationOutlined />} />
            </Dropdown>

            <Dropdown
              menu={{ items: themeItems, selectedKeys: [themeChoice], onClick: ({ key }) => changeTheme(key) }}
              trigger={['click']}
              placement="bottomRight"
            >
              <Button type="text" aria-label={t('aria.themeSwitcher')} icon={<BgColorsOutlined />} />
            </Dropdown>

            <Tooltip title={t('aria.currentUser', { name: user?.displayName ?? '' })} placement="bottom">
              <Button type="text" className="app-shell__user" icon={<Avatar size={24} icon={<UserOutlined />} />}>
                <span className="app-shell__user-name">{user?.displayName}</span>
              </Button>
            </Tooltip>

            <Tooltip title={t('aria.logout')} placement="bottom">
              <Button type="text" aria-label={t('aria.logout')} icon={<LogoutOutlined />} onClick={logout} />
            </Tooltip>
          </Space>
        </Header>

        <Content className="app-shell__content">{children}</Content>
      </Layout>
      </Layout>

      {/* The assistant renders a fixed-position panel mounted here, once, so it
          survives page navigation (its state lives in ai/chatStore). It must
          stay outside the Layout: as a flex child it would claim width and
          squeeze the content area to zero. */}
      {can('ai:chat') && (
        <Suspense fallback={null}>
          <AiChat />
        </Suspense>
      )}
    </>
  )
}
