/**
 * Cached window metrics for custom navigation bars.
 *
 * Every page with a custom nav bar needs statusBarHeight. Calling
 * wx.getWindowInfo in each page's onLoad would duplicate the fetch; this module
 * reads once and caches (CommonJS singleton), so data initializers can call it
 * synchronously at first-frame render.
 *
 * Page height needs no helper any more: with the native tabBar (app.json no
 * longer sets `custom: true`) the viewport already excludes the tab bar, so
 * pages can just use 100vh.
 */
interface NavInfo {
  statusBarHeight: number
}

let cached: NavInfo | null = null

export function getNavInfo(): NavInfo {
  if (cached) return cached
  const info = wx.getWindowInfo()
  cached = { statusBarHeight: info.statusBarHeight || 44 }
  return cached
}
