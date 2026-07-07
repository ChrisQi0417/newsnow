/* eslint-disable */

declare module 'glob:./sources/{*.ts,**/index.ts}' {
  export const apnews: typeof import('./sources/apnews')
  export const bbc: typeof import('./sources/bbc')
  export const chinanews: typeof import('./sources/chinanews')
  export const dw: typeof import('./sources/dw')
  export const govcn: typeof import('./sources/govcn')
  export const people: typeof import('./sources/people')
  export const reuters: typeof import('./sources/reuters')
  export const rfi: typeof import('./sources/rfi')
  export const scmp: typeof import('./sources/scmp')
  export const unnews: typeof import('./sources/unnews')
  export const xinhua: typeof import('./sources/xinhua')
}
