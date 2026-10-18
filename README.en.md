# dsh-image-hunt

[![npm](https://img.shields.io/npm/v/dsh-image-hunt)](https://www.npmjs.com/package/dsh-image-hunt)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![dsh-plugin](https://img.shields.io/badge/DSH-plugin-4b8bb4)](https://github.com/fomalhaut1998/dsh-image-hunt)

Multi-source image search for **DeepSeek Harness**: search, download into the session workspace, and show the results inline in the conversation. **Zero runtime dependencies.**

[中文](README.md) · [Changelog](CHANGELOG.md) · [npm](https://www.npmjs.com/package/dsh-image-hunt)

- **14 engines + 7 aliases**: 5 Chinese (Baidu / Bing / 360 / Duitang / Huaban), 4 international (DuckDuckGo / Yandex / Openverse / Wikimedia Commons), 4 anime (Pixiv / Wallhaven / Konachan / Safebooru), plus the Iconify icon library
- **Three tools**: `image_hunt` (search + download + render), `image_search` (search only), `image_download` (save a known direct URL)
- **Every file is traceable**: a sibling `meta.json` records the original URL, source page, title, **real pixel size**, human-readable site name and license
- **International sources use a proxy automatically**: the plugin ships its own CONNECT tunnel, no host env vars needed
- **Works without the plugin too**: the repo ships `cli.mjs`, one `node` command and the images are on disk

## Requirements

| Item | Requirement | Notes |
|---|---|---|
| DSH | 0.2.x (any build supporting `dsh.bundle` patches) | registered through `cordis.patch.yml`; host-side only, no client half |
| Node | **>= 18** | uses `fetch` and `AbortSignal.timeout` |
| Dependencies | **none** | pure ESM, only `node:` builtins (fs / path / net / tls / http / https / zlib) |
| OS | Windows / macOS / Linux | no platform-specific code |
| Proxy | only for international sources | defaults to `http://127.0.0.1:7890`; a dead proxy trips a breaker and falls back to direct |
| Session | a writable session workspace | `safeJoin` confines output to the workspace and throws on escape attempts |

## Install

```sh
# from npm (recommended)
dsh plugin --profile web add dsh-image-hunt

# or straight from GitHub, tracking the latest commit
dsh plugin --profile web add github:fomalhaut1998/dsh-image-hunt

# or link a local checkout into a profile
#   ~/.dsh/profiles/<profile>/package.json
#   dependencies["dsh-image-hunt"] = "link:/path/to/dsh-image-hunt"
#   and add "dsh-image-hunt" to dsh.profile.bundles
```

Published on [npm](https://www.npmjs.com/package/dsh-image-hunt).

**Restart DSH afterwards** — the host caches ESM modules, so edits to `index.js` only take effect after a restart.

Uninstall: `dsh plugin --profile web remove dsh-image-hunt`.

## Quick start

After installing, just talk to the agent — no parameters to memorise:

| You want | Say |
|---|---|
| Chinese stock photos | find 6 images of "city skyline long exposure", high resolution, no watermarks |
| Commercially usable | find 4 CC-licensed landscape photos I could use in an article |
| Anime, no AI art | find 8 Ghibli-style countryside landscapes, no AI-generated ones |
| Browse before downloading | search 20 candidates for "Morandi still life" and list them with sources |
| Save known URLs | download these URLs into `images/todo/` |

## Tools and parameters

### `image_hunt` — search + download + render

| Parameter | Type | Default | Description |
|---|---|---|---|
| `query` | string | **required** | Keywords. Chinese words are mapped to English tags for booru engines |
| `count` | integer | `8` | How many to download, 1–40. Fewer if candidates run out |
| `engine` | string | `auto` | One engine id or alias, see the table below |
| `sources` | string[] | — | Explicit source list; **overrides** `engine` and mixes freely |
| `minPixels` | integer | `0` | Minimum long edge; 0 disables. Use >= 1200 for decks and wallpapers. `icons` has no size and is unaffected |
| `noAI` | boolean | `false` | Non-AI only, **pixiv only** |
| `dir` | string | `images` | Output root, workspace-relative; files land in `dir/<query>/` |
| `collection` | string | — | `icons` only: `simple-icons` / `mdi` / `tabler` / `logos` / `ph` |
| `color` | string | — | `icons` only: recolour the SVG, e.g. `#ffffff` |

Return shape, from a real run:

```json
{
  "query": "Hemu village winter snow rime",
  "dir": "images/Hemu-冬季-雪-雾凇-村落-摄影",
  "downloaded": 4,
  "candidates": 17,
  "skipped": 0,
  "files": [
    {
      "path": "images/Hemu-冬季-雪-雾凇-村落-摄影/01.jpg",
      "bytes": 5866667,
      "source": "baidu",
      "site": "百度图片",
      "width": 1440,
      "height": 2128,
      "page": "https://…",
      "url": "https://…",
      "title": "Hemu winter wonderland"
    }
  ],
  "errors": []
}
```

`skipped` counts candidates dropped before download (below `minPixels`, unsupported format); `errors` carries per-source or per-file failures.

### `image_search` — search only

Parameters: `query`, `engine`, `sources`, `minPixels`, `noAI`, `collection`, `color` (same semantics as `image_hunt`, minus `count` and `dir`).

```json
{
  "query": "seaside town dusk",
  "sources": ["baidu", "so360", "bing"],
  "total": 160,
  "results": [
    { "engine": "so360", "full": "https://…", "thumb": "https://…", "page": "https://…",
      "title": "…", "width": 1920, "height": 1080 }
  ],
  "errors": []
}
```

Results are merged **round-robin** across engines so one source cannot monopolise the head; `total` is the de-duplicated count, `results` is capped at 20.

### `image_download` — save known direct URLs

| Parameter | Type | Default | Description |
|---|---|---|---|
| `urls` | string[] | **required** | Direct image URLs, 1–30 |
| `dir` | string | `images/downloads` | Output directory, workspace-relative |
| `prefix` | string | `img-` | Filename prefix with zero-padded index: `img-01.jpg` |
| `referer` | string | — | For hotlink protection (pixiv needs `https://www.pixiv.net/`) |
| `proxy` | boolean | `false` | Route this URL through the tunnel (needed for foreign hosts) |

Returns `{ dir, downloaded, files: [{ path, bytes, url }], errors }`. SVG files are written to disk but not registered as attachments.

## Engines

**14 engines** plus **7 aliases** — 21 names accepted by `engine`.

| id / alias | Source | Good for | Measured candidates / query |
|---|---|---|---|
| `auto` (default) | Baidu + 360 + Bing | Chinese general purpose, fastest | round-robin |
| `baidu` | Baidu Images | strongest Chinese semantics, titles included | 60 |
| `bing` | Bing Images (www, falls back to cn) | many original-resolution links | 70 |
| `so360` | 360 Images | biggest volume, fast, but thumbs are often 426×240 | 259 |
| `duitang` | Duitang | illustrations, avatars, stationery, phone wallpapers | 47 |
| `huaban` | Huaban | design, home, photography, mood boards | 40 |
| `icons` | Iconify | SVG icons and brand logos, recolourable | 40 |
| `all` | all 13 photo engines | a bit of everything | 270–371 |
| `both` | Baidu + Bing | Chinese semantics plus international originals | round-robin |
| `duckduckgo` | DuckDuckGo Images | international, no API key | 99 |
| `yandex` | Yandex Images | high-quality originals, includes Pinterest | 60 |
| `openverse` | Openverse | CC-licensed aggregation, license in metadata | 60 |
| `wikimedia` | Wikimedia Commons | public domain / CC, attribution usually required | 40 |
| `intl` | duckduckgo + yandex + bing | international mix | round-robin |
| `cc` | openverse + wikimedia | licensed / commercially usable material only | round-robin |
| `pixiv` | Pixiv | anime originals and fanart, artist originals | 82 |
| `wallhaven` | Wallhaven | SFW anime wallpapers, high resolution | 48–96 |
| `konachan` | Konachan | anime illustrations, score-sorted and steady | 44 |
| `safebooru` | Safebooru | largest volume, but many collages | 100 |
| `anime` | pixiv + wallhaven + konachan | recommended anime mix | round-robin |
| `moe` | anime + safebooru | anime, maximum volume | round-robin |

- `sources:["duitang","huaban"]` mixes arbitrary engines and is more flexible than an alias.
- `engine:"icons"` + `collection:"simple-icons"` gives brand logos (CC0); `color:"#ffffff"` recolours the SVG.
- **Foreign engines use the proxy**: duckduckgo / yandex / openverse / wikimedia / pixiv / wallhaven / konachan / safebooru are flagged `foreign`, and so is the www.bing.com international host.

### Three anime-specific behaviours

1. Pixiv downloads are upgraded to the **original** image via `/ajax/illust/<id>`; the artist is recorded in `license` as `Pixiv · @artist` and AI works are tagged `AI 生成`.
2. Booru engines (konachan / safebooru) **only accept ASCII tags**. A small Chinese→tag map is built in (宫崎骏 / 吉卜力 → `ghibli`, 龙猫 → `totoro`, 千与千寻 → `spirited_away`, …); unmapped Chinese words are dropped with an explanatory error.
3. `noAI:true` keeps non-AI works only (pixiv only; every remaining record had aiType 1 when measured).

> For **backgrounds without people**, combine `no_humans` with a topic tag on safebooru / konachan — far better than free text. Pixiv is character-first and is close to useless for scenery.

## Standalone CLI (no plugin needed)

`cli.mjs` in the repo root calls the very same implementation, without DSH:

```sh
# after cloning
node cli.mjs "Xinjiang Hemu village autumn" --n 4 --min-pixels 1200

# anime, no AI art
node cli.mjs "ghibli landscape" --engine anime --noai --n 6

# explicit sources and output directory
node cli.mjs "Morandi still life" --sources huaban,duitang --out images/still-life
```

| Flag | Meaning |
|---|---|
| `--n <number>` | how many to download, default 8 |
| `--engine <name>` | `auto` / `all` / `both` / `intl` / `cc` / `anime` / `moe` / `icons` or a single engine id |
| `--sources a,b` | explicit list, overrides `--engine` |
| `--out <dir>` | output root, default `images` |
| `--min-pixels <number>` | minimum long edge |
| `--collection <name>` / `--color <value>` | `icons` only |
| `--noai` | non-AI only (pixiv) |

The last line printed is JSON: `{ dir, downloaded, candidates, sources, files, skipped }`.

## Proxy (international engines only)

The plugin carries its own CONNECT tunnel, so no host environment variables are involved.

- Resolution order: `IMAGE_HUNT_PROXY` → `HTTPS_PROXY`/`https_proxy` → `HTTP_PROXY`/`http_proxy`; values `off`/`none`/`no`/`0`/`false` disable it; the default is `http://127.0.0.1:7890`.
- A dead proxy trips a 60 s breaker and falls back to a direct connection (international engines will usually time out); `proxyErrors` keeps the last 20 failures (url / error / code / addrs) for diagnosis.
- Three traps that cost real debugging time: ① writing a connected socket into `createConnection` of `http.request` is silently ignored by the implicit default Agent, so the request bypasses the tunnel — build `new Agent({keepAlive:false,maxSockets:1})` and override its `createConnection`; ② the CONNECT response must be accumulated up to `\r\n\r\n` with leftover bytes `unshift`-ed back onto the socket (the TLS handshake can arrive in the same packet); ③ the direct fallback forces IPv4 so IPv6-only records do not burn the whole timeout first.

## Design notes

- **Workspace confinement**: `safeJoin` keeps every output directory inside `exec.agent.session.header.cwd` and throws otherwise.
- **Usable paths**: `huntStandalone(..., relBase)` makes `files[].path` workspace-relative (`images/cat/01.jpg`), ready for `read_image` / HTML / `present`.
- **Rendering goes through the kernel**: images are registered as attachments (`ctx.attachments.saveImage`) and returned as `{type:"image", attachment}` blocks, rendered by `@deepseek-ai/dsh-client-ui-tool`; attachment names must be ASCII.
- **Pixel size comes from the file**, not from index metadata (Yandex reported 2844×1600 for a 2730×1536 file). `imgSize()` reads jpeg / png / webp headers into `width` / `height`; engine values are kept as `metaWidth` / `metaHeight`.
- **Format detected by magic bytes** (`sniffExt`) — safebooru `file_url`s often end in `.jpg` while the bytes are PNG, and content-type is unreliable too.
- **Parallel fan-out with round-robin merge** so a single source cannot monopolise the first N slots.

## Known limitations

| Site | Status |
|---|---|
| Google Images | `tbm=isch` returns a ~92 KB JavaScript shell; `AF_initDataCallback` and `encrypted-tbn` never appear; `gbv=1` is 2 KB; the legacy async endpoint returns 400. Not scrapeable. |
| Sogou Images | returns `{"status":1,"info":"forbid"}` even with cookies. |
| X / Instagram | logged-out shell pages plus bot protection; use a real browser session (BrowserSkill). |

DuckDuckGo and Yandex already aggregate Google / Bing results, which covers most needs.

## License, rights and disclaimer

- This plugin only performs **public-endpoint search and download**. It bypasses no login, paywall or hotlink protection, and it grants no rights to any image.
- Downloaded images **remain the property of their authors and sites**. The MIT license covers **the code only**, never the images you fetch with it.
- For personal or internal use, respect each site terms of service. **Before publishing, commercial use or redistribution, verify the license yourself** — results from `engine:"cc"` (Openverse / Wikimedia) carry a license field in `meta.json` as a starting point.
- Do not hammer the sources: they rate-limit, and accounts or IPs blocked for doing so are the operator responsibility.

## Contributing

- Bugs and breakage (sites redesign often): open an [issue](https://github.com/fomalhaut1998/dsh-image-hunt/issues) with the `engine`, the query and the exact `errors` text.
- Adding an engine: write `srcXxx(query, want)`, register one entry in `SOURCES`, and set `foreign:true` for international hosts — copy an existing source as a template.
- Pull requests must not add runtime dependencies (zero-dependency is a hard rule here).

## License

MIT © fomalhaut1998
