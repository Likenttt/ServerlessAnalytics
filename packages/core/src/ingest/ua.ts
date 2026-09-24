// A small user-agent parser for browser traffic. Native SDKs send explicit
// context, so this only has to cover the common browsers and platforms.

export interface ParsedUA {
  os: string | null
  osVersion: string | null
  browser: string | null
  device: string | null
  isBrowser: boolean
}

const OS_RULES: [RegExp, string, ((m: RegExpMatchArray) => string | null)?][] = [
  [/Windows NT (\d+\.\d+)/, 'Windows', (m) => ({ '10.0': '10', '6.3': '8.1', '6.2': '8', '6.1': '7' })[m[1]!] ?? m[1]!],
  [/(?:iPhone|iPod).*? OS (\d+)[_.](\d+)/, 'iOS', (m) => `${m[1]}.${m[2]}`],
  [/iPad.*? OS (\d+)[_.](\d+)/, 'iPadOS', (m) => `${m[1]}.${m[2]}`],
  [/Android (\d+(?:\.\d+)?)/, 'Android', (m) => m[1]!],
  [/CrOS/, 'ChromeOS'],
  [/Mac OS X (\d+)[_.](\d+)/, 'macOS', (m) => `${m[1]}.${m[2]}`],
  [/Linux/, 'Linux'],
]

const BROWSER_RULES: [RegExp, string][] = [
  [/Edg(?:e|A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/SamsungBrowser\//, 'Samsung Internet'],
  [/FxiOS\/|Firefox\//, 'Firefox'],
  [/CriOS\/|Chrome\//, 'Chrome'],
  [/Version\/[\d.]+.*Safari\//, 'Safari'],
]

export function parseUserAgent(ua: string | null | undefined): ParsedUA {
  if (!ua) return { os: null, osVersion: null, browser: null, device: null, isBrowser: false }
  let os: string | null = null
  let osVersion: string | null = null
  for (const [re, name, version] of OS_RULES) {
    const m = ua.match(re)
    if (m) {
      os = name
      osVersion = version ? version(m) : null
      break
    }
  }
  const browser = BROWSER_RULES.find(([re]) => re.test(ua))?.[1] ?? null
  const isBrowser = browser !== null && /Mozilla\//.test(ua)
  const device = !isBrowser ? null : /iPad|Tablet/.test(ua) ? 'Tablet' : /Mobi|iPhone|Android/.test(ua) ? 'Mobile' : 'Desktop'
  return { os, osVersion, browser, device, isBrowser }
}
