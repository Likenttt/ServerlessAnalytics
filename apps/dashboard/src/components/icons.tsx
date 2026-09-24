import type { SVGProps } from 'react'

// 16px stroke icons, drawn on a 16-unit grid to stay crisp.
type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Icon({ size = 16, children, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  )
}

export const Logo = ({ size = 24 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <rect width="32" height="32" rx="7" fill="var(--inverse-bg)" />
    <rect x="8" y="16" width="4" height="8" rx="1" fill="var(--inverse-fg)" />
    <rect x="14" y="11" width="4" height="13" rx="1" fill="var(--inverse-fg)" />
    <rect x="20" y="7" width="4" height="17" rx="1" fill="var(--inverse-fg)" />
  </svg>
)

export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 8.5 6.5 12 13 4.5" />
  </Icon>
)
export const CopyIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 3.5v-.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h.5" />
  </Icon>
)
export const ChevronDownIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m4 6 4 4 4-4" />
  </Icon>
)
export const ChevronUpDownIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m5 6 3-3 3 3M5 10l3 3 3-3" />
  </Icon>
)
export const ChevronRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m6 4 4 4-4 4" />
  </Icon>
)
export const PlusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 3v10M3 8h10" />
  </Icon>
)
export const XIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m4 4 8 8M12 4l-8 8" />
  </Icon>
)
export const ArrowUpIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 13V3M4 7l4-4 4 4" />
  </Icon>
)
export const ArrowDownIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 3v10M4 9l4 4 4-4" />
  </Icon>
)
export const SunIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="3" />
    <path d="M8 1.5v1M8 13.5v1M1.5 8h1M13.5 8h1M3.4 3.4l.7.7M11.9 11.9l.7.7M3.4 12.6l.7-.7M11.9 4.1l.7-.7" />
  </Icon>
)
export const MoonIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7Z" />
  </Icon>
)
export const MonitorIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="1.5" y="2.5" width="13" height="9" rx="1.5" />
    <path d="M5.5 14h5M8 11.5V14" />
  </Icon>
)
export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="m10.5 10.5 3 3" />
  </Icon>
)
export const TrashIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.5 7v4M9.5 7v4" />
  </Icon>
)
export const RefreshIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2v3h-3" />
  </Icon>
)
export const PauseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5.5 3v10M10.5 3v10" />
  </Icon>
)
export const PlayIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 2.5v11l9-5.5-9-5.5Z" />
  </Icon>
)
export const EyeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" />
    <circle cx="8" cy="8" r="2" />
  </Icon>
)
export const EyeOffIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2 2l12 12M6.6 6.7a2 2 0 0 0 2.7 2.7M4.2 4.3C2.5 5.5 1.5 8 1.5 8S4 12.5 8 12.5c1.3 0 2.5-.4 3.5-1M7 3.6c.3-.1.7-.1 1-.1 4 0 6.5 4.5 6.5 4.5s-.6 1.1-1.7 2.3" />
  </Icon>
)
export const GearIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="2" />
    <path d="M8 1.5v1.8M8 12.7v1.8M14.5 8h-1.8M3.3 8H1.5M12.6 3.4l-1.3 1.3M4.7 11.3l-1.3 1.3M12.6 12.6l-1.3-1.3M4.7 4.7 3.4 3.4" />
  </Icon>
)
export const LogOutIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 13.5H3.5a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1H6M10.5 11l3-3-3-3M13.5 8H6" />
  </Icon>
)
export const FilterIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2 3.5h12M4.5 8h7M7 12.5h2" />
  </Icon>
)
export const ExternalIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9.5 2.5h4v4M13.5 2.5 7.5 8.5M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3" />
  </Icon>
)
export const InfoIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="6.5" />
    <path d="M8 7.5V11M8 5h.01" />
  </Icon>
)
export const WarningIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 2 1.5 13.5h13L8 2ZM8 6.5v3M8 11.5h.01" />
  </Icon>
)
export const MinusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 8h9" />
  </Icon>
)
