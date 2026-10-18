# Changelog

## 1.4.1 — 2026-10-18 · 文档重写 + 独立 CLI 开源

- **新增 `cli.mjs`（仓库根）**：不装 DSH 也能用 —— `node cli.mjs "关键词" --n 4 --engine anime --min-pixels 1200`。直接 import `./index.js`，不经过宿主；`package.json` 加了 `bin.dsh-image-hunt`，`files` 也带上它。实测冒烟：`--n 1 --engine baidu` → candidates 59 / downloaded 1 / exit 0。
- **修正图源数量**：旧 README 写「19 个图源：国内 5 / 国外 8 / 二次元 4」，与代码不符（`SOURCES` 是 **14 条**，5+8+4 也不等于 19）。现统一为「**14 个图源 + 7 个别名** = 21 个 engine 名」，并把漏掉的 `both` 补进表。
- **补齐三张参数表**：`image_hunt`（query / count / engine / sources / minPixels / noAI / dir / collection / color）、`image_search`、`image_download`（urls / dir / prefix / referer / proxy），含默认值与取值范围。此前 `minPixels` 在 README 里一次都没出现。
- **新增 Requirements 表**：DSH 0.2.x（需 `dsh.bundle` 补丁支持）、Node ≥ 18、零依赖、三平台通用、代理仅国外源需要、输出收口于会话工作区。
- **新增「快速上手」与「独立 CLI」两节**，给可直接照抄的问法与命令。
- **新增「合规与免责」**：只做公开接口检索 + 下载、不绕过登录/付费墙、图片版权归原作者、MIT 只覆盖代码、自用/商用前自行确认授权、不要高频猛刷。
- **英文版与中文对齐**：README.en.md 从 92 行扩到 247 行，结构与中文一致（要求 / 参数表 / 返回 JSON / 别名 / CLI / 代理三个坑 / 免责）。
- 两份 README 都加了 badge（npm 版本 / MIT / Node / DSH 插件）。
- 纯文档 + 新增 CLI，无运行时行为改动。

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
