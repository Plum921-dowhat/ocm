// 品牌注入点（小程序端）。
//
// 规则与 web 端 src/brand 一致：有注入则注入值生效，无注入则用 OCM 默认值。
// 与 web 的差别在于实现方式——小程序没有打包器（开发者工具直接编译 TS），
// 做不到 `import.meta.glob` 那种"文件存在才加载、不存在就 tree-shake"，
// 缺失模块在编译期就报错。因此覆盖文件必须始终存在：上游发一个空对象，
// 下游只改 `config/brand.override.ts`，不碰本文件。
//
// 下游用法（示例）：
//
//   export const brandOverride: Partial<BrandConfig> = {
//     name: '示例大学',
//     titleCloud: '智慧教室管理',
//     systemName: '智慧教室管理系统',
//   }
//
// 注意：`app.json` / `project.config.json` 是编译器直接读取的 JSON，导入不了
// 这里的值——navigationBarTitleText、tabBar 配色、appid 仍需在各自文件里改。

import { brandOverride } from './brand.override'

export interface BrandConfig {
  /** 品牌词：登录页页脚前缀、通知/占位文案。默认「OCM」。 */
  name: string
  /** 登录页副标题。默认「智慧教室管理」。 */
  titleCloud: string
  /** 系统全称，登录页页脚用。默认「智慧教室管理系统」。 */
  systemName: string
  /** AI 助手名称。默认「<name> AI 助手」。 */
  aiName: string
  /**
   * Logo 图片，代码包内绝对路径。**唯一方案，没有文字 logo 兜底**：
   * 默认值指向上游自带的 `/assets/brand/logo.png`（与 web 的
   * `src/assets/logo.png` 同一张图），保证上游每次回归都会走到图片渲染路径。
   * 下游换 logo：把新图放进代码包（如 `/assets/brand/school.png`）再改这里，
   * 不要覆盖上游默认图，避免以后合并二进制冲突。
   */
  logoImage: string
}

const defaults: BrandConfig = {
  name: 'OCM',
  titleCloud: '智慧教室管理',
  systemName: '智慧教室管理系统',
  aiName: 'OCM AI 助手',
  logoImage: '/assets/brand/logo.png'
}

// 空串是合法取值（例如下游想去掉副标题），所以用 ?? 而不是 ||。
const name = brandOverride.name ?? defaults.name

/** 生效品牌：覆盖值优先，缺省回落 OCM 默认值。 */
export const brand: BrandConfig = {
  name,
  titleCloud: brandOverride.titleCloud ?? defaults.titleCloud,
  systemName: brandOverride.systemName ?? defaults.systemName,
  aiName: brandOverride.aiName ?? `${name} AI 助手`,
  logoImage: brandOverride.logoImage ?? defaults.logoImage
}
