# Changelog

## 1.4.0 — 2026-10-18 · Anime sources · first npm release

Published as `dsh-image-hunt` on npm — install with `dsh plugin --profile web add dsh-image-hunt`.
Package renamed from `@local/dsh-image-hunt`; the repo root **is** the plugin directory, so
`github:fomalhaut1998/dsh-image-hunt` installs it directly.

- Added four login-free sources: `pixiv`, `wallhaven`, `konachan`, `safebooru`. Aliases: `anime` = pixiv + wallhaven + konachan; `moe` adds safebooru.
- Pixiv: search via `ajax/search/artworks` (`popular_d` first, `date_d` to top up); downloads resolve `urls.original` through `ajax/illust/<id>`. `i.pximg.net` requires `Referer: https://www.pixiv.net/` (403 otherwise). Measured `aiType` semantics: **1 = non-AI, 2 = AI**; the server-side `ai_type` parameter has no effect, so filtering is client-side → new `noAI` option.
- Booru sites only accept ASCII tags: added `TAG_MAP` (宫崎骏/吉卜力→ghibli, 龙猫→totoro, 千与千寻→spirited_away, 魔女宅急便→kiki, 初音未来→hatsune_miku, …). Unmapped Chinese words are dropped with an explanatory error.
- File extension is now sniffed from magic bytes (`sniffExt`) — safebooru `file_url`s often end in `.jpg` while the bytes are PNG, and content-type is unreliable too.
- Measured through `127.0.0.1:7890`: `ghibli` → pixiv 82 / wallhaven 48 / konachan 44 / safebooru 100 candidates; `--engine anime` wrote 3 files with exit 0.

## 1.3.0 — 2026-09-28 · Proxy + international sources

- Added `duckduckgo`, `yandex`, `openverse`, `wikimedia`, plus `intl` and `cc` aliases.
- Built-in CONNECT tunnel; only international sources use it (`image_download` gained a `proxy` flag; `apply()` accepts `config.proxy`).
- **meta sizes now come from the file**: engines report index metadata that frequently disagrees with the downloaded bytes (Yandex claimed 2844x1600 for a 2730x1536 file; Wikimedia reported a 2000x1333 thumbnail while serving a 3000x2000 original). `imgSize()` reads jpeg/png/webp headers into `width`/`height`; engine values are kept as `metaWidth`/`metaHeight`.
- Four real bugs fixed:

  | # | Symptom | Cause | Fix |
  |---|---|---|---|
  | 1 | CLI crashed with AggregateError / ETIMEDOUT | hand-made socket had no `error` listener | `guard()` attaches error + timeout |
  | 2 | every international source silently timed out | a connected socket written into `createConnection` is ignored by the implicit default Agent | build `new Agent()` and override its `createConnection` |
  | 3 | Yandex: `matchAll called with a non-global RegExp` | reused a non-global regex | `new RegExp(re.source, 'g')` |
  | 4 | Openverse returned Django DRF browsable HTML instead of JSON | that endpoint selects its renderer via query param | append `&format=json` |

## 1.2.0 — 2026-09-28 · Attribution

- `SITE_NAMES` + `siteOf()`: every file carries a `site` field with the human-readable Chinese site name (百度图片 / 花瓣网 / 堆糖 / 360图片 / 必应图片 / Iconify / …). The `:thumb` suffix is stripped before lookup.

## 1.1.0 — 2026-09-28 · More sources

- Added 360, Duitang, Huaban and Iconify; engines gained `auto` / `all` / `icons` / single id, plus `sources` arrays, `collection`, `color`, `relBase`.
- Baidu returns two kinds of dirty JSON (both had to be handled):

  | # | Symptom | Cause | Fix |
  |---|---|---|---|
  | 1 | `Bad control character in string literal … position 38438` | a raw TAB inside a string value | strip `[\u0000-\u001f]` before parsing |
  | 2 | `Bad escaped character in JSON … position 21356` | Baidu escapes single quotes as `\'` | replace `\\'` with `'` |

- `parseLoose()` degrades in three steps (as-is → strip control chars → fix `\'`), then falls back to the regex-based `baiduRows()` (splits on `"thumbURL"`), so one bad record cannot kill the whole source.

## 1.0.0 — 2026-09-28

- First release: Baidu + Bing, three tools, workspace confinement, inline image rendering.
