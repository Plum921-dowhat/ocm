// 下游品牌覆盖文件（唯一需要定制的品牌文件）。
//
// 上游保持本文件为空对象，默认品牌 = OCM；下游只填需要的字段即可，例如：
//
//   export const brandOverride: Partial<BrandConfig> = {
//     name: '示例大学',
//     systemName: '示例大学智慧教室管理系统',
//     logoImage: '/assets/brand/school-logo.png',
//   }
//
// `logoImage` 是必填项（没有文字 logo 兜底）：换 logo 时把图片放进代码包，
// 再把路径填到这里；不填则沿用上游默认图 `/assets/brand/logo.png`。
//
// 改这里只影响品牌文案，不影响任何业务逻辑；字段缺省时自动用
// `config/brand.ts` 的默认值，所以升级上游时通常无需重新对齐。
import type { BrandConfig } from './brand'

export const brandOverride: Partial<BrandConfig> = {}
