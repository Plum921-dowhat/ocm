import type { ComponentType, CSSProperties } from 'react'

// The navigation contract types an icon as a component that accepts a `size`
// prop (see config/navigation.ts). That shape was Carbon's; Ant Design icons
// take `style` instead. toNavIcon bridges the two without leaking either
// library into the downstream injection point: a downstream override keeps
// declaring `icon: SomeIcon` of the same shape it always did.
export function toNavIcon(
  Icon: ComponentType<{ style?: CSSProperties; className?: string }>,
): ComponentType<{ size?: number | string }> {
  return function NavIcon({ size = 18 }: { size?: number | string }) {
    return <Icon style={{ fontSize: size }} />
  }
}
