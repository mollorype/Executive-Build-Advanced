# shwethazinmoe-supabase-proxy

Cloudflare Worker reverse proxy that fronts the Supabase project
`ryubjollofribrvrwqtz` at `https://api.shwethazinmoe.site`, so users on
ISPs that block `*.supabase.co` by SNI/DNS can still reach the
database, auth, storage, and realtime APIs through Cloudflare's Anycast
network under our own domain.

## What it does

- Rewrites the `Host` header and target hostname to
  `ryubjollofribrvrwqtz.supabase.co` for every request.
- Passes through `/rest/v1/*`, `/auth/v1/*`, `/storage/v1/*`,
  `/realtime/v1/*` — path and query string are untouched, only the
  protocol/hostname/port of the URL are rewritten.
- Handles `OPTIONS` CORS preflight itself (204, with
  `Access-Control-Allow-Origin` echoing the request's `Origin` and
  `Access-Control-Allow-Headers` echoing the browser's
  `Access-Control-Request-Headers`, falling back to
  `authorization, x-client-info, apikey, content-type, prefer, range, x-upsert`).
- Passes through WebSocket upgrades (`Upgrade: websocket`) for Supabase
  Realtime subscriptions.

## Deploy

```bash
cd cloudflare/shwethazinmoe-supabase-proxy
npx wrangler login
npx wrangler deploy
```

`wrangler.toml`'s `routes` entry attaches the Worker to
`api.shwethazinmoe.site/*` on the `shwethazinmoe.site` zone
automatically. That requires a DNS record for `api` to already exist on
the zone and be **Proxied** (orange cloud) — an A record to
`192.0.2.1` (never actually reached; Cloudflare intercepts the request
at the edge before it would resolve there) works, or use **Workers &
Pages → your worker → Settings → Domains & Routes → Add Custom
Domain** instead, which creates the DNS record and certificate for you
and makes the `routes` block above unnecessary.

## Verify before flipping production traffic

```bash
curl -i https://api.shwethazinmoe.site/rest/v1/ \
  -H "apikey: sb_publishable_gzut68hKDAV9cirHdk8bpw_O_yTUXZS"
```

A response with Supabase's usual REST-root headers/body (not a
Cloudflare error page) means the proxy is reaching the origin
correctly.

## Netlify environment variables

Set these in **both** Netlify sites (stm-financial and stm-daily) —
Site settings → Environment variables:

| Key | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://api.shwethazinmoe.site` |
| `VITE_SUPABASE_ANON_KEY` | `sb_publishable_gzut68hKDAV9cirHdk8bpw_O_yTUXZS` |

These env vars take priority over the fallbacks baked into
`artifacts/stm-financial/src/lib/supabase.ts` and
`artifacts/stm-daily/src/lib/supabase.ts` — the app won't actually
route through the proxy in production until they're set.

After saving, trigger **Deploys → Trigger deploy → Clear cache and
deploy site** (not just a normal redeploy) so Vite re-embeds the new
`VITE_SUPABASE_URL` into the compiled JS bundle — Vite inlines
`import.meta.env.*` values at build time, so a plain re-deploy from a
cached build would keep serving the old URL.
