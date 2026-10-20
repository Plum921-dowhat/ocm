import { useMemo, type ReactNode } from 'react'
import { App as AntdApp, ConfigProvider } from 'antd'
import enUS from 'antd/locale/en_US'
import zhCN from 'antd/locale/zh_CN'
import useLanguage from '../i18n/useLanguage'
import { useTheme } from './ThemeContext'
import { buildAntdTheme } from './antd'

// AntdProvider supplies the Ant Design theme and locale. It sits inside
// ThemeProvider (colour mode) and LanguageProvider (locale) so a single
// preference drives both design systems during the migration: Carbon still
// reads its cds-- class from <html>, Ant Design reads this config.
//
// <AntdApp> gives components access to the context-aware message/modal/
// notification APIs (Ant Design v6 no longer encourages the static methods).
export default function AntdProvider({ children }: { children: ReactNode }) {
  const { colorScheme } = useTheme()
  const { language } = useLanguage()

  const themeConfig = useMemo(() => buildAntdTheme(colorScheme), [colorScheme])
  const locale = language?.startsWith('zh') ? zhCN : enUS

  return (
    <ConfigProvider theme={themeConfig} locale={locale} componentSize="middle">
      <AntdApp>{children}</AntdApp>
    </ConfigProvider>
  )
}
