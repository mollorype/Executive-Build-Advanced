export default {
  async fetch(request, env, ctx) {
    const SUPABASE_HOST = "ryubjollofribrvrwqtz.supabase.co";
    const url = new URL(request.url);
    const corsHeaders = buildCorsHeaders(request);

    // ── CORS preflight ──────────────────────────────────────────────
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Point the URL at Supabase — path (/rest/v1/*, /auth/v1/*,
    // /storage/v1/*, /realtime/v1/*, ...) and query string pass through
    // untouched since only protocol/hostname/port are rewritten.
    url.protocol = "https:";
    url.hostname = SUPABASE_HOST;
    url.port = "";

    // ── WebSocket pass-through (Supabase Realtime) ─────────────────
    const upgrade = request.headers.get("Upgrade");
    if (upgrade && upgrade.toLowerCase() === "websocket") {
      const wsHeaders = new Headers(request.headers);
      wsHeaders.set("Host", SUPABASE_HOST);
      return fetch(url.toString(), {
        method: request.method,
        headers: wsHeaders,
      });
    }

    // ── Normal HTTP methods (GET/POST/PUT/PATCH/DELETE/HEAD) ───────
    const proxyHeaders = new Headers(request.headers);
    proxyHeaders.set("Host", SUPABASE_HOST);
    proxyHeaders.set("X-Forwarded-Host", url.hostname);
    if (request.headers.get("CF-Connecting-IP")) {
      proxyHeaders.set("X-Forwarded-For", request.headers.get("CF-Connecting-IP"));
    }

    const hasBody = !["GET", "HEAD"].includes(request.method);

    const proxyRequest = new Request(url.toString(), {
      method: request.method,
      headers: proxyHeaders,
      body: hasBody ? request.body : undefined,
      // "follow" (default) so Supabase Storage's public-URL redirects keep working
    });

    const upstreamResponse = await fetch(proxyRequest);

    // Re-attach CORS headers on the way back to the browser
    const responseHeaders = new Headers(upstreamResponse.headers);
    for (const [key, value] of Object.entries(corsHeaders)) {
      responseHeaders.set(key, value);
    }

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  },
};

function buildCorsHeaders(request) {
  return {
    "Access-Control-Allow-Origin": request.headers.get("Origin") || "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      request.headers.get("Access-Control-Request-Headers") ||
      "authorization, x-client-info, apikey, content-type, prefer, range, x-upsert",
    "Access-Control-Expose-Headers": "content-range, x-supabase-api-version",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}
