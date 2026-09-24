export function sourceFailure(stage: string, error?: unknown) {
  const failure = error as { status?: number, statusCode?: number, name?: string, cause?: { name?: string } } | undefined
  const status = failure?.statusCode ?? failure?.status
  const reason = Number.isInteger(status) && status! >= 100 && status! <= 599
    ? `http-${status}`
    : /timeout|abort/i.test(`${failure?.name} ${failure?.cause?.name}`)
      ? "timeout"
      : error ? "request-failed" : "empty"
  return `${stage}:${reason}`
}

export class SourceUnavailableError extends Error {
  constructor(readonly issues: string[]) {
    super("Source upstreams unavailable")
  }
}
