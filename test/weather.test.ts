import { describe, expect, it } from "vitest"
import { cycloneToNewsItem, parseJmaFeedEntries, parseJmaTyphoonBulletin, parseNhcStorms, resolveCloudflareLocation, weatherToNewsItem } from "../server/sources/weather"

describe("weather and tropical cyclone source", () => {
  it("uses Cloudflare IP geolocation without exposing the IP address", () => {
    const location = resolveCloudflareLocation({
      city: "Denver",
      country: "US",
      latitude: "39.73920",
      longitude: "-104.99030",
      region: "Colorado",
    })

    expect(location).toEqual({
      detail: "Denver，Colorado，US",
      label: "Denver",
      latitude: 39.7392,
      longitude: -104.9903,
      scope: "local",
    })
    expect(resolveCloudflareLocation({ latitude: "invalid", longitude: "116.4" })).toBeUndefined()
  })

  it("formats current weather and today's range in Chinese", () => {
    const location = resolveCloudflareLocation({
      city: "Denver",
      country: "US",
      latitude: "39.7392",
      longitude: "-104.9903",
      region: "Colorado",
    })!
    const item = weatherToNewsItem(location, {
      current: {
        apparent_temperature: 25.1,
        relative_humidity_2m: 42,
        temperature_2m: 26.4,
        time: 1786546800,
        weather_code: 2,
        wind_direction_10m: 90,
        wind_gusts_10m: 28.2,
        wind_speed_10m: 14.6,
      },
      daily: {
        precipitation_probability_max: [20],
        temperature_2m_max: [31.2],
        temperature_2m_min: [17.8],
      },
      timezone: "America/Denver",
    })

    expect(item).toMatchObject({
      title: "IP所在地｜Denver · 多云 26.4°C · 体感 25.1°C",
      pubDate: 1786546800000,
      extra: { info: "今日 17.8–31.2°C · 降水 20% · 风 15 km/h" },
    })
    expect(item?.extra?.hover).toContain("风向风速：东 14.6 km/h")
    expect(item?.title).not.toContain("39.7392")
  })

  it("selects the newest JMA bulletin per typhoon channel and parses the current storm", () => {
    const entries = parseJmaFeedEntries(`
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <title>台風解析・予報情報（５日予報）（Ｈ３０）</title>
          <updated>2026-08-12T12:40:33Z</updated>
          <link type="application/xml" href="https://www.data.jma.go.jp/developer/xml/data/latest_VPTW60_010000.xml"/>
        </entry>
        <entry>
          <title>台風解析・予報情報（５日予報）（Ｈ３０）</title>
          <updated>2026-08-12T09:40:33Z</updated>
          <link type="application/xml" href="https://www.data.jma.go.jp/developer/xml/data/older_VPTW60_010000.xml"/>
        </entry>
        <entry><title>気象警報・注意報</title></entry>
      </feed>
    `)
    expect(entries).toHaveLength(1)
    expect(entries[0].url).toContain("latest_VPTW60")

    const cyclone = parseJmaTyphoonBulletin(`
      <Report xmlns="http://xml.kishou.go.jp/jmaxml1/" xmlns:jmx_eb="http://xml.kishou.go.jp/jmaxml1/elementBasis1/">
        <Head><EventID>TC2620</EventID></Head>
        <Body>
          <MeteorologicalInfos>
            <MeteorologicalInfo>
              <DateTime type="実況">2026-08-12T21:00:00+09:00</DateTime>
              <Item>
                <Kind><Property><Type>呼称</Type><TyphoonNamePart><Name>NANGKA</Name><NameKana>ナンカー</NameKana><Number>2617</Number><Remark/></TyphoonNamePart></Property></Kind>
                <Kind><Property><Type>階級</Type><ClassPart><jmx_eb:TyphoonClass>台風(TS)</jmx_eb:TyphoonClass></ClassPart></Property></Kind>
                <Kind><Property><Type>中心</Type><CenterPart>
                  <jmx_eb:Coordinate type="中心位置（度）">+23.4+144.8/</jmx_eb:Coordinate>
                  <Location>小笠原近海</Location>
                  <jmx_eb:Direction unit="１６方位漢字">東北東</jmx_eb:Direction>
                  <jmx_eb:Speed unit="km/h">25</jmx_eb:Speed>
                  <jmx_eb:Pressure unit="hPa">994</jmx_eb:Pressure>
                </CenterPart></Property></Kind>
                <Kind><Property><Type>風</Type><WindPart><jmx_eb:WindSpeed unit="m/s" type="最大風速">18</jmx_eb:WindSpeed></WindPart></Property></Kind>
              </Item>
            </MeteorologicalInfo>
          </MeteorologicalInfos>
        </Body>
      </Report>
    `, entries[0].url)

    expect(cyclone).toMatchObject({
      eventId: "TC2620",
      latitude: 23.4,
      longitude: 144.8,
      maxWind: 18,
      movementSpeed: 25,
      name: "NANGKA",
      pressure: 994,
      provider: "JMA",
    })
    expect(cycloneToNewsItem(cyclone!).title)
      .toBe("实时台风/飓风｜西北太平洋 第17号 NANGKA · 23.4°N 144.8°E · 最大风速 18 m/s")
  })

  it("parses NHC active-storm JSON into the same display model", () => {
    const [cyclone] = parseNhcStorms({
      activeStorms: [{
        classification: "TS",
        id: "al032026",
        intensity: "40",
        lastUpdate: "2026-08-12T15:00:00.000Z",
        latitudeNumeric: 36.7,
        longitudeNumeric: -43,
        movementDir: 90,
        movementSpeed: 25,
        name: "Cristobal",
        pressure: "1008",
        publicAdvisory: { url: "https://www.nhc.noaa.gov/text/MIATCPAT3.shtml" },
      }],
    })
    const item = cycloneToNewsItem(cyclone)

    expect(item.title).toBe("实时台风/飓风｜大西洋 热带风暴 Cristobal · 36.7°N 43.0°W · 最大风速 40 节")
    expect(item.extra?.info).toBe("1,008 hPa · 向东移动 · 25 节")
    expect(item.url).toBe("https://www.nhc.noaa.gov/text/MIATCPAT3.shtml")
  })
})
