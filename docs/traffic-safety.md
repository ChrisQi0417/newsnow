# Traffic safety hotfix

The previous implementation combined cache-bypassing refreshes, retries and
translation fallback fan-out. These are credible traffic amplifiers, not proof
of the exact cause of a third-party network warning.

- Fresh source caches are respected even for older clients sending `latest`.
- Client automatic and manual refreshes have a 15-minute cooldown.
- A source attempt reserves a 15-minute worker-local cooldown before fetching,
  including failed attempts. Weather is excluded because it is request-local.
- All upstream fetches, including translation, share a worker-local budget of
  60 attempts/minute total and 12 attempts/minute per hostname.
- Automatic upstream retries are disabled, including source overrides.
- Network failures, HTTP 403/429 and 5xx block that hostname for at least
  15 minutes; longer Retry-After values are honored.
- Translation uses one endpoint, sequential batches and an 8-second timeout.
  Failure retains cached Chinese or original text, without alternate domains.
- The audit script requires 1-3 explicit source IDs and spaces requests.

Limits held in memory are per worker instance, not a global distributed quota.
The existing shared source cache reduces traffic across instances, but strict
deployment-wide quotas require an atomic shared limiter (for example a Durable
Object) or platform rate-limit rules. A local/network-provider block is not
automatically lifted by deploying this patch. Do not rotate IPs or proxies to
bypass it. Verification should use offline mocks and minimal cached HTTP probes.
