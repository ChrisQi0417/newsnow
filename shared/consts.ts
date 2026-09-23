/**
 * 缓存过期时间
 */
import packageJSON from "../package.json"

export const TTL = 10 * 60 * 1000
export const ManualRefreshCooldown = 60_000
/**
 * 默认刷新间隔, 1 hour
 */
export const Interval = 60 * 60 * 1000

export const Homepage = packageJSON.homepage

export const Version = packageJSON.version
export const Author = packageJSON.author
