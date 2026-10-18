# dsh-image-hunt

Multi-source image search for **DeepSeek Harness**: search, download into the session workspace, and show the results inline in the conversation. Zero runtime dependencies.

[中文](README.md) · [Changelog](CHANGELOG.md)

- 19 engines: 5 Chinese, 8 international, 4 anime/illustration sources (plus two icon-oriented aliases)
- Three tools: `image_hunt` (search + download + render), `image_search` (search only), `image_download` (save a known direct URL)
- Every downloaded file gets a sibling `meta.json`: original URL, source page, title, **real pixel size**, human-readable site name, license
- International sources go through a proxy automatically — the plugin ships its own CONNECT tunnel, no host env vars needed

## Install

```sh
dsh plugin --profile web add github:fomalhaut1998/dsh-image-hunt
```

Restart DSH afterwards — the host caches ESM modules, so edits to `index.js` only take effect after a restart.

Uninstall: `dsh plugin --profile web remove dsh-image-hunt`.

## Engines

| id | Source | Good for |
|---|---|---|
| `auto` (default) | Baidu + 360 + Bing | Chinese general-purpose, fastest combination |
| `baidu` | Baidu Images | strongest Chinese semantic matching, titles included |
| `bing` | Bing Images (falls back to cn.bing.com) | many direct original-resolution links |
| `so360` | 360 Images | largest result volume, very fast |
| `duitang` | Duitang | illustrations, avatars, wallpapers |
| `huaban` | Huaban | design, home, photography, mood boards |
| `icons` | Iconify | SVG icons and brand logos (recolorable) |
| `all` | every image source above | "give me a bit of everything" |
| `duckduckgo` | DuckDuckGo Images | international, no API key |
| `yandex` | Yandex Images | high-quality originals, includes Pinterest originals |
| `openverse` | Openverse | CC-licensed aggregation, license in metadata |
| `wikimedia` | Wikimedia Commons | public-domain / CC material, attribution required |
| `intl` | duckduckgo + yandex + bing | international mix |
| `cc` | openverse + wikimedia | only licensed / commercially usable material |
| `pixiv` | Pixiv | anime originals and fanart, artist originals |
| `wallhaven` | Wallhaven | SFW anime wallpapers, high resolution |
| `konachan` | Konachan | anime illustrations, score-sorted |
| `safebooru` | Safebooru | largest booru, but lots of collages |
| `anime` | pixiv + wallhaven + konachan | recommended anime mix |
| `moe` | anime + safebooru | anime, maximum volume |

Notes:

- `sources: ["duitang","huaban"]` mixes arbitrary engines.
- Booru sites only understand ASCII tags; a small Chinese→tag map is built in (宫崎骏/吉卜力→`ghibli`, 龙猫→`totoro`, …). For scenery-only backgrounds, combine `no_humans` with a topic tag — that beats free-text.
- Pixiv downloads are upgraded to the original image via `/ajax/illust/<id>`, and the artist is recorded in `license` as `Pixiv · @artist`. `noAI: true` drops AI-generated works.

## Proxy

Resolution order: `IMAGE_HUNT_PROXY` → `HTTPS_PROXY` → `HTTP_PROXY`, default `http://127.0.0.1:7890`. Set it to `off` to disable. Only the international engines use it; Chinese engines stay direct. A dead proxy trips a 60 s circuit breaker and falls back to a direct connection.

## Tools

| Tool | What it does |
|---|---|
| `image_hunt` | search + download + render; writes `images/<query>/` and `meta.json` |
| `image_search` | search only, returns candidates with their source engine |
| `image_download` | save a known direct URL (optional referer for hotlink protection; `proxy: true` to route it through the tunnel) |

## Design notes

- **Workspace confinement**: `safeJoin` keeps every output directory inside `exec.agent.session.header.cwd`.
- **Paths are workspace-relative** (`images/cat/01.jpg`), so the returned paths are directly usable.
- **Rendering goes through the kernel**: images are registered as attachments and returned as `{type:'image', attachment}` blocks; `@deepseek-ai/dsh-client-ui-tool` renders the card.
- **Pixel size comes from the file**, not the index metadata (Yandex reported 2844x1600 for a 2730x1536 file).
- **Format detection by magic bytes** (`sniffExt`) — some boorus serve a `.jpg` URL whose bytes are PNG.
- **Parallel fan-out with round-robin merge** so a single source cannot monopolize the first N slots.

## Known limitations

| Site | Status |
|---|---|
| Google Images | `tbm=isch` returns a ~92 KB JavaScript shell; `AF_initDataCallback` and `encrypted-tbn` never appear. Not scrapeable. |
| Sogou Images | returns `{"status":1,"info":"forbid"}` even with cookies. |
| X / Instagram | logged-out shell pages plus bot protection; needs a real browser session (BrowserSkill). |

DuckDuckGo and Yandex already aggregate Google/Bing results, which covers most needs.

## License

MIT
