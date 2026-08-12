import type { NewsItem } from "@shared/types"
import { XMLParser } from "fast-xml-parser"

interface WeatherLocation {
  detail: string
  label: string
  latitude: number
  longitude: number
  scope: "beijing" | "local"
}

interface WeatherResponse {
  current?: {
    apparent_temperature?: number
    relative_humidity_2m?: number
    temperature_2m?: number
    time?: number
    weather_code?: number
    wind_direction_10m?: number
    wind_gusts_10m?: number
    wind_speed_10m?: number
  }
  daily?: {
    precipitation_probability_max?: number[]
    temperature_2m_max?: number[]
    temperature_2m_min?: number[]
  }
  timezone?: string
}

interface JmaFeedEntry {
  code: string
  updatedAt: number
  url: string
}

interface CycloneSnapshot {
  basin: string
  classification: string
  direction?: string
  eventId: string
  latitude?: number
  location?: string
  longitude?: number
  maxWind?: number
  movementSpeed?: number
  name: string
  nameKana?: string
  number?: string
  pressure?: number
  provider: "JMA" | "NHC"
  publishedAt: number
  url: string
}

interface NhcResponse {
  activeStorms?: Array<{
    classification?: string
    id?: string
    intensity?: number | string
    lastUpdate?: string
    latitudeNumeric?: number | string
    longitudeNumeric?: number | string
    movementDir?: number | string
    movementSpeed?: number | string
    name?: string
    pressure?: number | string
    publicAdvisory?: { url?: string }
  }>
}

const beijingLocation: WeatherLocation = {
  detail: "北京市，中国",
  label: "北京",
  latitude: 39.9042,
  longitude: 116.4074,
  scope: "beijing",
}

const jmaFeedUrl = "https://www.data.jma.go.jp/developer/xml/feed/extra.xml"
const jmaTyphoonPage = "https://www.jma.go.jp/bosai/map.html#5/"
const nhcCurrentStormsUrl = "https://www.nhc.noaa.gov/CurrentStorms.json"
const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true })
const sharedCacheDuration = 5 * 60 * 1000
let sharedCache: { expiresAt: number, items: NewsItem[] } | undefined
let sharedRequest: Promise<NewsItem[]> | undefined

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

function asRecord(value: unknown): Record<string, any> | undefined {
  return value && typeof value === "object" ? value as Record<string, any> : undefined
}

function textOf(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value).trim()
  const record = asRecord(value)
  return record ? textOf(record["#text"]) : ""
}

function finiteNumber(value: unknown) {
  const number = typeof value === "string" && value.trim() === "" ? Number.NaN : Number(value)
  return Number.isFinite(number) ? number : undefined
}

function formatNumber(value: number, digits = 1) {
  return value.toLocaleString("zh-CN", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  })
}

function weatherDescription(code: number | undefined) {
  if (code === 0) return "晴"
  if (code === 1) return "晴间多云"
  if (code === 2) return "多云"
  if (code === 3) return "阴"
  if (code === 45 || code === 48) return "雾"
  if ([51, 53, 55].includes(code ?? -1)) return "毛毛雨"
  if ([56, 57, 66, 67].includes(code ?? -1)) return "冻雨"
  if (code === 61) return "小雨"
  if (code === 63) return "中雨"
  if (code === 65) return "大雨"
  if (code === 71) return "小雪"
  if (code === 73) return "中雪"
  if (code === 75) return "大雪"
  if (code === 77) return "雪粒"
  if ([80, 81, 82].includes(code ?? -1)) return "阵雨"
  if ([85, 86].includes(code ?? -1)) return "阵雪"
  if (code === 95) return "雷暴"
  if ([96, 99].includes(code ?? -1)) return "雷暴伴冰雹"
  return "天气状况未知"
}

function directionFromDegrees(value: number | undefined) {
  if (value === undefined) return "风向未知"
  const directions = ["北", "东北偏北", "东北", "东北偏东", "东", "东南偏东", "东南", "东南偏南", "南", "西南偏南", "西南", "西南偏西", "西", "西北偏西", "西北", "西北偏北"]
  return directions[Math.round(((value % 360) + 360) % 360 / 22.5) % 16]
}

function japaneseDirection(value: string | undefined) {
  const directions: Record<string, string> = {
    北: "北",
    北北東: "东北偏北",
    北東: "东北",
    東北東: "东北偏东",
    東: "东",
    東南東: "东南偏东",
    南東: "东南",
    南南東: "东南偏南",
    南: "南",
    南南西: "西南偏南",
    南西: "西南",
    西南西: "西南偏西",
    西: "西",
    西北西: "西北偏西",
    北西: "西北",
    北北西: "西北偏北",
  }
  return value ? directions[value] ?? value : "方向未知"
}

function coordinates(latitude: number | undefined, longitude: number | undefined) {
  if (latitude === undefined || longitude === undefined) return "位置未知"
  const latitudeLabel = `${formatNumber(Math.abs(latitude))}°${latitude >= 0 ? "N" : "S"}`
  const longitudeLabel = `${formatNumber(Math.abs(longitude))}°${longitude >= 0 ? "E" : "W"}`
  return `${latitudeLabel} ${longitudeLabel}`
}

export function resolveCloudflareLocation(cf: unknown): WeatherLocation | undefined {
  const record = asRecord(cf)
  const latitude = finiteNumber(record?.latitude)
  const longitude = finiteNumber(record?.longitude)
  if (latitude === undefined || longitude === undefined || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return

  const parts = [record?.city, record?.region, record?.country]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map(value => value.trim())
  const uniqueParts = [...new Set(parts)]
  return {
    detail: uniqueParts.join("，") || "IP 地理位置",
    label: uniqueParts[0] || "当前位置",
    latitude,
    longitude,
    scope: "local",
  }
}

export function weatherToNewsItem(location: WeatherLocation, response: WeatherResponse): NewsItem | undefined {
  const current = response.current
  const temperature = finiteNumber(current?.temperature_2m)
  if (!current || temperature === undefined) return

  const apparent = finiteNumber(current.apparent_temperature)
  const minimum = finiteNumber(response.daily?.temperature_2m_min?.[0])
  const maximum = finiteNumber(response.daily?.temperature_2m_max?.[0])
  const rainChance = finiteNumber(response.daily?.precipitation_probability_max?.[0])
  const windSpeed = finiteNumber(current.wind_speed_10m)
  const windGust = finiteNumber(current.wind_gusts_10m)
  const humidity = finiteNumber(current.relative_humidity_2m)
  const updatedAt = finiteNumber(current.time)
  const prefix = location.scope === "local" ? `IP所在地｜${location.label}` : location.label
  const titleParts = [`${prefix} · ${weatherDescription(finiteNumber(current.weather_code))} ${formatNumber(temperature)}°C`]
  if (apparent !== undefined) titleParts.push(`体感 ${formatNumber(apparent)}°C`)

  const info: string[] = []
  if (minimum !== undefined && maximum !== undefined) info.push(`今日 ${formatNumber(minimum)}–${formatNumber(maximum)}°C`)
  if (rainChance !== undefined) info.push(`降水 ${formatNumber(rainChance, 0)}%`)
  if (windSpeed !== undefined) info.push(`风 ${formatNumber(windSpeed, 0)} km/h`)

  return {
    id: `weather-${location.scope}-${location.latitude.toFixed(2)}-${location.longitude.toFixed(2)}`,
    title: titleParts.join(" · "),
    url: "https://open-meteo.com/en/docs",
    pubDate: updatedAt === undefined ? Date.now() : updatedAt * 1000,
    extra: {
      info: info.join(" · "),
      hover: [
        `位置：${location.detail}（IP 近似定位）`,
        `坐标：${coordinates(location.latitude, location.longitude)}`,
        humidity === undefined ? "" : `相对湿度：${formatNumber(humidity, 0)}%`,
        windSpeed === undefined ? "" : `风向风速：${directionFromDegrees(finiteNumber(current.wind_direction_10m))} ${formatNumber(windSpeed)} km/h`,
        windGust === undefined ? "" : `阵风：${formatNumber(windGust)} km/h`,
        response.timezone ? `时区：${response.timezone}` : "",
        "数据源：Open-Meteo",
      ].filter(Boolean).join("\n"),
    },
  }
}

export function parseJmaFeedEntries(xml: string): JmaFeedEntry[] {
  const data = parser.parse(xml)
  const entries = asArray(asRecord(data)?.feed?.entry)
  const seen = new Set<string>()
  return entries.flatMap((entry): JmaFeedEntry[] => {
    const record = asRecord(entry)
    if (!textOf(record?.title).includes("台風解析・予報情報")) return []
    const links = asArray(record?.link).map(asRecord).filter(Boolean)
    const url = links.find(link => link?.["@_type"] === "application/xml")?.["@_href"] ?? textOf(record?.id)
    const code = typeof url === "string" ? url.match(/_(VPTW6\d)_/)?.[1] : undefined
    if (!code || seen.has(code)) return []
    seen.add(code)
    const updatedAt = new Date(textOf(record?.updated)).getTime()
    return [{ code, updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(), url }]
  }).slice(0, 6)
}

function coordinateValues(value: string) {
  const match = value.match(/^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)\/$/)
  if (!match) return {}
  return { latitude: finiteNumber(match[1]), longitude: finiteNumber(match[2]) }
}

function propertyByType(item: Record<string, any>, type: string) {
  return asArray(item.Kind)
    .map(kind => asRecord(kind)?.Property)
    .map(asRecord)
    .find(property => textOf(property?.Type) === type)
}

function childByUnit(value: unknown, unit: string, type?: string) {
  return asArray(value).map(asRecord).find((child) => {
    if (child?.["@_unit"] !== unit) return false
    return !type || child?.["@_type"] === type
  })
}

export function parseJmaTyphoonBulletin(xml: string, url: string): CycloneSnapshot | undefined {
  const report = asRecord(parser.parse(xml))?.Report
  const head = asRecord(report?.Head)
  const infos = asArray(report?.Body?.MeteorologicalInfos?.MeteorologicalInfo)
  const currentInfo = infos.map(asRecord).find(info => asRecord(info?.DateTime)?.["@_type"] === "実況")
  const item = asRecord(asArray(currentInfo?.Item)[0])
  if (!head || !currentInfo || !item) return

  const naming = propertyByType(item, "呼称")?.TyphoonNamePart
  const classPart = propertyByType(item, "階級")?.ClassPart
  const center = propertyByType(item, "中心")?.CenterPart
  const wind = propertyByType(item, "風")?.WindPart
  const classification = textOf(classPart?.TyphoonClass)
  const remark = textOf(naming?.Remark)
  if (!classification.includes("台風") || remark.includes("消滅")) return

  const coordinateNode = asArray(center?.Coordinate).map(asRecord).find(node => node?.["@_type"] === "中心位置（度）")
  const coordinate = coordinateValues(textOf(coordinateNode))
  const movementSpeed = finiteNumber(textOf(childByUnit(center?.Speed, "km/h")))
  const pressure = finiteNumber(textOf(childByUnit(center?.Pressure, "hPa")))
  const maxWind = finiteNumber(textOf(childByUnit(wind?.WindSpeed, "m/s", "最大風速")))
  const publishedAt = new Date(textOf(currentInfo.DateTime)).getTime()
  const eventId = textOf(head.EventID)
  const name = textOf(naming?.Name) || eventId
  if (!eventId || !name) return

  return {
    basin: "西北太平洋",
    classification: classification.replace(/\(.+\)/, ""),
    direction: japaneseDirection(textOf(childByUnit(center?.Direction, "１６方位漢字"))),
    eventId,
    ...coordinate,
    location: textOf(center?.Location),
    maxWind,
    movementSpeed,
    name,
    nameKana: textOf(naming?.NameKana),
    number: textOf(naming?.Number),
    pressure,
    provider: "JMA",
    publishedAt: Number.isFinite(publishedAt) ? publishedAt : Date.now(),
    url,
  }
}

function nhcClassification(value: string) {
  const classifications: Record<string, string> = {
    DB: "热带扰动",
    HU: "飓风",
    PT: "后热带气旋",
    SD: "亚热带低压",
    SS: "亚热带风暴",
    TD: "热带低压",
    TS: "热带风暴",
  }
  return classifications[value] ?? value
}

function nhcBasin(id: string) {
  const basins: Record<string, string> = {
    al: "大西洋",
    cp: "中太平洋",
    ep: "东太平洋",
  }
  return basins[id.slice(0, 2).toLocaleLowerCase()] ?? "美国国家飓风中心监测区"
}

export function parseNhcStorms(response: NhcResponse): CycloneSnapshot[] {
  return (response.activeStorms ?? []).flatMap((storm): CycloneSnapshot[] => {
    const eventId = typeof storm.id === "string" ? storm.id : ""
    const name = typeof storm.name === "string" ? storm.name.trim() : ""
    const publishedAt = new Date(storm.lastUpdate ?? "").getTime()
    if (!eventId || !name || !Number.isFinite(publishedAt)) return []
    return [{
      basin: nhcBasin(eventId),
      classification: nhcClassification(storm.classification ?? ""),
      direction: directionFromDegrees(finiteNumber(storm.movementDir)),
      eventId,
      latitude: finiteNumber(storm.latitudeNumeric),
      longitude: finiteNumber(storm.longitudeNumeric),
      maxWind: finiteNumber(storm.intensity),
      movementSpeed: finiteNumber(storm.movementSpeed),
      name,
      pressure: finiteNumber(storm.pressure),
      provider: "NHC",
      publishedAt,
      url: storm.publicAdvisory?.url ?? "https://www.nhc.noaa.gov/",
    }]
  })
}

export function cycloneToNewsItem(cyclone: CycloneSnapshot): NewsItem {
  const number = cyclone.number ? String(Number(cyclone.number.slice(-2))) : ""
  const displayName = cyclone.provider === "JMA" && number
    ? `第${number}号 ${cyclone.name}`
    : `${cyclone.classification} ${cyclone.name}`
  const windUnit = cyclone.provider === "JMA" ? "m/s" : "节"
  const title = [
    `实时台风/飓风｜${cyclone.basin} ${displayName}`,
    coordinates(cyclone.latitude, cyclone.longitude),
    cyclone.maxWind === undefined ? "" : `最大风速 ${formatNumber(cyclone.maxWind, 0)} ${windUnit}`,
  ].filter(Boolean).join(" · ")
  const info = [
    cyclone.pressure === undefined ? "" : `${formatNumber(cyclone.pressure, 0)} hPa`,
    cyclone.direction ? `向${cyclone.direction}移动` : "",
    cyclone.movementSpeed === undefined ? "" : `${formatNumber(cyclone.movementSpeed, 0)} ${cyclone.provider === "JMA" ? "km/h" : "节"}`,
  ].filter(Boolean).join(" · ")

  return {
    id: `cyclone-${cyclone.provider.toLocaleLowerCase()}-${cyclone.eventId}`,
    title,
    url: cyclone.url,
    pubDate: cyclone.publishedAt,
    extra: {
      info,
      hover: [
        cyclone.location ? `位置：${cyclone.location}` : "",
        cyclone.nameKana ? `日文名称：${cyclone.nameKana}` : "",
        `类型：${cyclone.classification}`,
        `发布时间：${new Date(cyclone.publishedAt).toISOString()}`,
        `数据源：${cyclone.provider === "JMA" ? "日本气象厅" : "美国国家飓风中心"}`,
      ].filter(Boolean).join("\n"),
    },
  }
}

async function fetchWeather(location: WeatherLocation) {
  const url = new URL("https://api.open-meteo.com/v1/forecast")
  url.searchParams.set("latitude", String(location.latitude))
  url.searchParams.set("longitude", String(location.longitude))
  url.searchParams.set("current", "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m")
  url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,precipitation_probability_max")
  url.searchParams.set("forecast_days", "1")
  url.searchParams.set("timeformat", "unixtime")
  url.searchParams.set("timezone", "auto")
  const response = await myFetch<WeatherResponse>(url, { retry: 1, timeout: 8000 })
  const item = weatherToNewsItem(location, response)
  if (!item) throw new Error(`Cannot parse weather for ${location.label}`)
  return item
}

async function fetchJmaCyclones() {
  const feed = await myFetch<string>(jmaFeedUrl, { responseType: "text", retry: 1, timeout: 10000 })
  const entries = parseJmaFeedEntries(feed)
  const results = await Promise.all(entries.map(async (entry) => {
    try {
      const bulletin = await myFetch<string>(entry.url, { responseType: "text", retry: 1, timeout: 8000 })
      return parseJmaTyphoonBulletin(bulletin, entry.url)
    } catch (error) {
      logger.warn(`failed to fetch JMA typhoon bulletin ${entry.code}`, error)
    }
  }))
  return results.filter((item): item is CycloneSnapshot => Boolean(item))
}

async function fetchNhcCyclones() {
  const response = await myFetch<NhcResponse>(nhcCurrentStormsUrl, {
    headers: { "User-Agent": "NewsNow weather monitor" },
    retry: 1,
    timeout: 8000,
  })
  return parseNhcStorms(response)
}

async function fetchCycloneItems() {
  const results = await Promise.allSettled([fetchJmaCyclones(), fetchNhcCyclones()])
  const cyclones = results.flatMap(result => result.status === "fulfilled" ? result.value : [])
  if (cyclones.length) {
    return cyclones
      .sort((a, b) => b.publishedAt - a.publishedAt)
      .map(cycloneToNewsItem)
  }

  const allSourcesAvailable = results.every(result => result.status === "fulfilled")
  return [{
    id: "cyclone-current-status",
    title: allSourcesAvailable
      ? "实时台风/飓风｜当前监测范围内无活动风暴"
      : "实时台风/飓风｜部分官方监测源暂时不可用",
    url: jmaTyphoonPage,
    pubDate: Date.now(),
    extra: {
      info: "JMA · NHC",
      hover: "监测范围：西北太平洋、大西洋、东太平洋和中太平洋",
    },
  } satisfies NewsItem]
}

async function getSharedItems() {
  const now = Date.now()
  if (sharedCache && sharedCache.expiresAt > now) return sharedCache.items
  if (sharedRequest) return sharedRequest

  sharedRequest = Promise.allSettled([fetchWeather(beijingLocation), fetchCycloneItems()])
    .then((results) => {
      const items: NewsItem[] = []
      const weatherResult = results[0]
      const cycloneResult = results[1]
      if (weatherResult.status === "fulfilled") {
        items.push(weatherResult.value)
      } else {
        items.push({
          id: "weather-beijing-unavailable",
          title: "北京｜天气数据暂时不可用",
          url: "https://open-meteo.com/en/docs",
          pubDate: Date.now(),
          extra: { info: "稍后刷新重试" },
        })
      }
      if (cycloneResult.status === "fulfilled") {
        items.push(...cycloneResult.value)
      }
      sharedCache = { expiresAt: Date.now() + sharedCacheDuration, items }
      return items
    })
    .finally(() => {
      sharedRequest = undefined
    })
  return sharedRequest
}

export default defineSource(async (event) => {
  const location = resolveCloudflareLocation(event?.context.cf)
  const [localResult, sharedResult] = await Promise.allSettled([
    location ? fetchWeather(location) : Promise.reject(new Error("Cloudflare IP location unavailable")),
    getSharedItems(),
  ])

  const items: NewsItem[] = []
  if (localResult.status === "fulfilled") {
    items.push(localResult.value)
  } else {
    items.push({
      id: "weather-local-unavailable",
      title: "IP所在地｜暂时无法读取当地天气",
      url: "https://developers.cloudflare.com/workers/runtime-apis/request/#incomingrequestcfproperties",
      pubDate: Date.now(),
      extra: { info: "请从已部署的网站刷新" },
    })
  }
  if (sharedResult.status === "fulfilled") {
    items.push(...sharedResult.value)
  }
  if (!items.length) throw new Error("Cannot fetch weather or cyclone data")
  return items
})
