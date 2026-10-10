#!/usr/bin/env node
//
// Render deploy/frontend/firebase.json from the environment. Written by
// deploy.sh into firebase.json before `firebase deploy`; never edited by hand.
//
//   CLOUD_URL   — the cloud node base (hub, customer, employee)
//   STORE_URL   — the store edge base (store console, web till)
//   DC_URL      — the DC edge base, for the hub's Operations module (optional;
//                 omitted and the hub's /edge rewrite is skipped)
//
// Rewrites keep every surface same-origin with the node it talks to: the
// browser sees one origin, so the SameSite=Strict session cookie is actually
// sent. `/edge/:path*` forwards with the prefix stripped, matching the dev
// proxy in frontend-hub/vite.config.ts. The trailing `**` is the SPA fallback,
// and loses to the /api rewrite above it because first match wins.

const trim = (url) => url.replace(/\/+$/, "")
const CLOUD_URL = trim(process.env.CLOUD_URL ?? "")
const STORE_URL = trim(process.env.STORE_URL ?? "")
const DC_URL = trim(process.env.DC_URL ?? "")

const hubRewrites = [
  { source: "/api/:path*", destination: `${CLOUD_URL}/api/:path` },
  ...(DC_URL ? [{ source: "/edge/:path*", destination: `${DC_URL}/:path` }] : []),
  { source: "**", destination: "/index.html" },
]

/// Cache headers, shared by every site.
///
/// A built asset's name carries a hash of its contents, so the same URL is
/// always the same bytes: it is cached for a year and never revalidated, and a
/// new build is simply new names that nobody has cached. Everything else —
/// `index.html` above all, which is how a browser learns those names — is
/// `no-cache`: small, revalidated on every open, so a deploy is picked up on
/// the next URL click rather than up to an hour later (the default), and a
/// stale `index.html` referencing chunks a later deploy deleted cannot happen.
///
/// This is what makes a repeat visit fast without a service worker (owner,
/// 2026-10-10: the offline worker is off): the shell's scripts and styles come
/// from the disk cache at zero network cost, and only the HTML is asked for.
/// Firebase's header rules cascade — a later, narrower source overrides an
/// earlier, wider one — so the order below is load-bearing: the broad
/// `no-cache` first, the immutable asset rule after it.
const cacheHeaders = [
  {
    source: "**",
    headers: [{ key: "Cache-Control", value: "no-cache" }],
  },
  {
    source: "/assets/**",
    headers: [
      { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
    ],
  },
]

const api = (target) => [
  { source: "/api/:path*", destination: `${target}/api/:path` },
  { source: "**", destination: "/index.html" },
]

const site = (target, publicDir, rewrites) => ({
  target,
  public: publicDir,
  ignore: ["firebase.json", "**/.*", "**/node_modules/**"],
  rewrites,
  headers: cacheHeaders,
})

const config = {
  hosting: [
    site("hub", "public/hub", hubRewrites),
    site("store", "public/store", api(STORE_URL)),
    site("pos", "public/pos", api(STORE_URL)),
    site("customer", "public/customer", api(CLOUD_URL)),
    site("employee", "public/employee", api(CLOUD_URL)),
  ],
}

process.stdout.write(JSON.stringify(config, null, 2) + "\n")
