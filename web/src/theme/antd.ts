import { theme as antdTheme, type ThemeConfig } from 'antd'
import type { ColorScheme } from './ThemeContext'

// Ant Design theme for OCM.
//
// The brand palette is the one already used by the mini-program and the
// existing web pages (see src/app.scss): indigo #2B5FF6, mint #00C49A and the
// #F5F7FA app background. Keeping it here rather than in CSS means every
// Ant Design component inherits the same primary without per-component
// overrides.
export const BRAND_PRIMARY = '#2B5FF6'
export const BRAND_ACCENT = '#FF7A45'

// Replaces IBM Plex Sans, the single strongest "this looks like Carbon"
// signal. System UI faces render Chinese with the platform's own CJK font
// (PingFang SC on macOS, Microsoft YaHei on Windows), which is what users of
// Ant Design-based admin consoles expect.
export const FONT_FAMILY =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Arial, sans-serif"

const LIGHT_BG = '#f5f7fa'
const DARK_BG = '#161616'
const LIGHT_SURFACE = '#ffffff'
const DARK_SURFACE = '#1f1f1f'

export function buildAntdTheme(scheme: ColorScheme): ThemeConfig {
  const dark = scheme === 'dark'
  return {
    algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: BRAND_PRIMARY,
      colorInfo: BRAND_PRIMARY,
      colorLink: BRAND_PRIMARY,
      colorSuccess: '#00C49A',
      colorBgLayout: dark ? DARK_BG : LIGHT_BG,
      colorBgContainer: dark ? DARK_SURFACE : LIGHT_SURFACE,
      borderRadius: 6,
      fontFamily: FONT_FAMILY,
      fontSize: 14,
      wireframe: false,
    },
    components: {
      Layout: {
        headerBg: dark ? DARK_SURFACE : LIGHT_SURFACE,
        siderBg: dark ? DARK_SURFACE : LIGHT_SURFACE,
        bodyBg: dark ? DARK_BG : LIGHT_BG,
        headerHeight: 56,
        headerPadding: '0 16px',
      },
      Menu: {
        itemHeight: 40,
        itemMarginInline: 8,
        itemBorderRadius: 6,
        subMenuItemBg: 'transparent',
        iconSize: 16,
      },
      Table: {
        headerBg: dark ? '#262626' : '#fafafa',
        headerSplitColor: 'transparent',
        cellPaddingBlock: 10,
        cellPaddingInline: 12,
      },
      Card: {
        borderRadiusLG: 10,
      },
      Modal: {
        titleFontSize: 16,
      },
    },
  }
}
