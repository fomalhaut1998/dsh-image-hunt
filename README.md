# dsh-image-hunt

[![npm](https://img.shields.io/npm/v/dsh-image-hunt)](https://www.npmjs.com/package/dsh-image-hunt)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![dsh-plugin](https://img.shields.io/badge/DSH-plugin-4b8bb4)](https://github.com/fomalhaut1998/dsh-image-hunt)

多图源搜图 → 下载进当前会话工作区 → 图片直接显示在对话里。**DeepSeek Harness 宿主插件，零外部依赖。**

[English](README.en.md) · [更新日志](CHANGELOG.md) · [npm](https://www.npmjs.com/package/dsh-image-hunt)

- **14 个图源 + 7 个别名**：国内 5（百度 / 必应 / 360 / 堆糖 / 花瓣）、国外 4（DuckDuckGo / Yandex / Openverse / 维基共享资源）、二次元 4（Pixiv / Wallhaven / Konachan / Safebooru）、外加 Iconify 图标库
- **三个工具**：`image_hunt`（搜 + 下 + 显示）、`image_search`（只搜）、`image_download`（已知直链落盘）
- **每张图都有据可查**：同目录 `meta.json` 记原图直链、来源页、标题、真实像素、来源站中文名、授权信息
- **国外源自动走代理**：插件内建 CONNECT 隧道，不依赖宿主环境变量；国内源照旧直连
- **不装插件也能跑**：仓库自带 `cli.mjs`，一条 `node` 命令直接出图

## 要求

| 项 | 要求 | 说明 |
|---|---|---|
| DSH | 0.2.x（支持 `dsh.bundle` 补丁的版本） | 通过 `cordis.patch.yml` 注册，纯宿主侧，无需客户端半 |
| Node | **≥ 18** | 用到 `fetch` 与 `AbortSignal.timeout` |
| 依赖 | **无** | 纯 ESM，只用 `node:` 内置模块（fs / path / net / tls / http / https / zlib） |
| 系统 | Windows / macOS / Linux | 无平台特定代码 |
| 代理 | 仅国外源需要 | 默认 `http://127.0.0.1:7890`；不通会熔断并回退直连 |
| 会话 | 一个可写的会话工作区 | 输出目录被 `safeJoin` 限制在工作区内，越界直接报错 |

## 安装

```sh
# 从 npm 装（推荐）
dsh plugin --profile web add dsh-image-hunt

# 或直接从 GitHub 装，跟最新提交
dsh plugin --profile web add github:fomalhaut1998/dsh-image-hunt

# 或本地开发：把本仓库 link 进 profile
#   ~/.dsh/profiles/<profile>/package.json
#   dependencies["dsh-image-hunt"] = "link:/path/to/dsh-image-hunt"
#   并把 "dsh-image-hunt" 加进 dsh.profile.bundles
```

已发布：[npmjs.com/package/dsh-image-hunt](https://www.npmjs.com/package/dsh-image-hunt)。

装完**重启 DSH**（宿主会缓存 ESM 模块，改完 `index.js` 也必须重启才生效）。

卸载：`dsh plugin --profile web remove dsh-image-hunt`。

## 快速上手

装完直接对 agent 说人话，不必记参数：

| 想要什么 | 这么说 |
|---|---|
| 中文配图 | 帮我找 6 张「城市夜景 长曝光」，要高清、不要水印 |
| 可商用素材 | 找 4 张 CC 授权、可商用的山林图，之后可能用在文章里 |
| 二次元 / 不要 AI 图 | 找 8 张吉卜力风格的乡间风景，不要 AI 生成的 |
| 只挑不下 | 先搜 20 张「莫兰迪 静物」，把候选和来源列给我 |
| 已知直链 | 把这几条 URL 的图下到 `images/todo/` |

## 工具与参数

### `image_hunt` —— 搜 + 下 + 显示

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `query` | string | **必填** | 关键词。中文词在 booru 系会被内置映射转成英文 tag |
| `count` | integer | `8` | 目标下载张数，1–40。候选不足时会少给 |
| `engine` | string | `auto` | 单个图源 id 或别名，见下方图源表 |
| `sources` | string[] | — | 直接给源数组，**覆盖** `engine`，可任意混用 |
| `minPixels` | integer | `0` | 长边下限，0 = 不过滤。做 PPT / 背景图建议 ≥ 1200；`icons` 无尺寸不受影响 |
| `noAI` | boolean | `false` | 只要非 AI 图，**仅 pixiv 生效** |
| `dir` | string | `images` | 输出根目录（工作区相对路径），实际落 `dir/<关键词>/` |
| `collection` | string | — | `icons` 专用图标集：`simple-icons` / `mdi` / `tabler` / `logos` / `ph` |
| `color` | string | — | `icons` 专用，给 SVG 上色，如 `#ffffff` |

返回形状（真实一次调用的结果）：

```json
{
  "query": "禾木 冬季 雪 雾凇 村落 摄影",
  "dir": "images/禾木-冬季-雪-雾凇-村落-摄影",
  "downloaded": 4,
  "candidates": 17,
  "skipped": 0,
  "files": [
    {
      "path": "images/禾木-冬季-雪-雾凇-村落-摄影/01.jpg",
      "bytes": 5866667,
      "source": "baidu",
      "site": "百度图片",
      "width": 1440,
      "height": 2128,
      "page": "https://…",
      "url": "https://…",
      "title": "禾木冬日奇景：风雪中的童话世界"
    }
  ],
  "errors": []
}
```

`skipped` 是被跳过的候选（尺寸低于 `minPixels`、格式不支持等），`errors` 里是单个源或单张图的失败原因。

### `image_search` —— 只搜不下

参数：`query`、`engine`、`sources`、`minPixels`、`noAI`、`collection`、`color`（语义同 `image_hunt`，没有 `count` / `dir`）。

```json
{
  "query": "海边小镇 黄昏",
  "sources": ["baidu", "so360", "bing"],
  "total": 160,
  "results": [
    { "engine": "so360", "full": "https://…", "thumb": "https://…", "page": "https://…",
      "title": "…", "width": 1920, "height": 1080 }
  ],
  "errors": []
}
```

结果按源**轮转交错**，避免前 N 条被单个源占满；`total` 是去重过滤后的总数，`results` 截到 20 条。

### `image_download` —— 已知直链落盘

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `urls` | string[] | **必填** | 图片直链，1–30 条 |
| `dir` | string | `images/downloads` | 输出目录（工作区相对路径） |
| `prefix` | string | `img-` | 文件名前缀，序号自动补零：`img-01.jpg` |
| `referer` | string | — | 过防盗链用（如 pixiv 需 `https://www.pixiv.net/`） |
| `proxy` | boolean | `false` | 让这条直链走代理（抓国外图站时需要） |

返回 `{ dir, downloaded, files: [{ path, bytes, url }], errors }`。SVG 只落盘，不登记为附件。

## 图源（engine / sources）

共 **14 个图源**，另有 **7 个别名**，合计 21 个可填的 `engine` 名。

| id / 别名 | 站点 | 适合 | 实测候选 / 查询 |
|---|---|---|---|
| `auto`（默认） | 百度 + 360 + Bing | 中文综合，最快 | 三源轮转 |
| `baidu` | 百度图片 | 中文语义最强，带来源标题 | 60 |
| `bing` | 必应图片（www → cn 自动兜底） | 国际原图直链多 | 70 |
| `so360` | 360 图片 | 量最大、快，但缩略图常只有 426×240 | 259 |
| `duitang` | 堆糖 | 插画 / 头像 / 手账 / 手机壁纸 | 47 |
| `huaban` | 花瓣 | 设计 / 家居 / 摄影 / 灵感图 | 40 |
| `icons` | Iconify 图标库 | SVG 图标、品牌 logo（可改色） | 40 |
| `all` | 除图标外全部 13 个 photo 源 | 要「什么都来一点」 | 270–371 |
| `both` | 百度 + 必应 | 中文语义 + 国际原图，两源互补 | 两源轮转 |
| `duckduckgo` | DuckDuckGo 图片 | 国际图，免 key | 99 |
| `yandex` | Yandex 图片 | 原图直链质量高，含 Pinterest 原图 | 60 |
| `openverse` | Openverse | CC 授权图库聚合，带 license | 60 |
| `wikimedia` | 维基共享资源 | 公有领域 / CC，多数需署名 | 40 |
| `intl` | duckduckgo + yandex + bing | 国外综合 | 三源轮转 |
| `cc` | openverse + wikimedia | 只要带授权 / 可商用的图 | 两源轮转 |
| `pixiv` | Pixiv | 二次元原创 / 同人，画师原图 | 82 |
| `wallhaven` | Wallhaven | 二次元壁纸，SFW，高分辨率 | 48–96 |
| `konachan` | Konachan | 二次元插画，按评分排序，质量稳 | 44 |
| `safebooru` | Safebooru | 量最大，但多合辑 / 拼贴 | 100 |
| `anime` | pixiv + wallhaven + konachan | 二次元综合（推荐） | 三源轮转 |
| `moe` | anime + safebooru | 二次元要量 | 四源轮转 |

- `sources:["duitang","huaban"]` 可任意混用，比合成别名更灵活。
- `engine:"icons"` + `collection:"simple-icons"` = 品牌 logo（CC0）；`color:"#ffffff"` 给 SVG 上色。
- **国外源走代理**：duckduckgo / yandex / openverse / wikimedia / pixiv / wallhaven / konachan / safebooru 标记为 foreign，只有它们经代理；bing 的 www 国际站同理。

### 二次元源的三个特性

1. pixiv 下载时会用 `/ajax/illust/<id>` 换成**原图**，画师写进 meta 的 `license`（形如 `Pixiv · @作者`），AI 图另标 `AI 生成`；
2. booru 系（konachan / safebooru）**只认英文 tag**，中文词走内置映射（宫崎骏 / 吉卜力 → `ghibli`、龙猫 → `totoro`、千与千寻 → `spirited_away` …），映射不到的中文词会被丢掉并报错；
3. `noAI:true` 只要非 AI 图（仅 pixiv 生效，实测过滤后 aiType 全为 1）。

> 想找**纯景背景**（无人物），在 safebooru / konachan 上组合 `no_humans` + 主题词，比自由词有效得多。pixiv 是角色本位，搜风景基本不可用。

## 独立 CLI（不装插件也能用）

仓库根目录的 `cli.mjs` 直接调用同一份实现，不经过 DSH：

```sh
# 克隆后
node cli.mjs "新疆 禾木村 秋景" --n 4 --min-pixels 1200

# 二次元 + 排除 AI 图
node cli.mjs "吉卜力 风景" --engine anime --noai --n 6

# 指定源 + 自定义输出目录
node cli.mjs "莫兰迪 静物" --sources huaban,duitang --out images/still-life
```

| 参数 | 说明 |
|---|---|
| `--n <数字>` | 下载张数，默认 8 |
| `--engine <名>` | `auto` / `all` / `both` / `intl` / `cc` / `anime` / `moe` / `icons` 或单个源 id |
| `--sources a,b` | 直接列源，覆盖 `--engine` |
| `--out <目录>` | 输出根目录，默认 `images` |
| `--min-pixels <数字>` | 长边下限 |
| `--collection <名>` / `--color <色>` | `icons` 专用 |
| `--noai` | 只要非 AI 图（仅 pixiv） |

输出末行是 JSON：`{ dir, downloaded, candidates, sources, files, skipped }`。

## 代理（只给国外源用）

插件内建 CONNECT 隧道，无需宿主环境变量。

- 解析顺序：`IMAGE_HUNT_PROXY` → `HTTPS_PROXY`/`https_proxy` → `HTTP_PROXY`/`http_proxy`；值取 `off`/`none`/`no`/`0`/`false` 表示关闭；缺省 `http://127.0.0.1:7890`。
- 代理不通 → 60s 熔断 + 自动退回直连（国外源此时多半超时）；`proxyErrors` 保留最近 20 条失败原因（url / error / code / addrs）供诊断。
- 三个必踩的坑：① 把连好的 socket 塞进 `http.request` 的 `createConnection` 会被隐式默认 Agent 忽略，请求绕开隧道直连 → 必须自建 `new Agent({keepAlive:false,maxSockets:1})` 并覆写其 `createConnection`；② CONNECT 响应要累积到 `\r\n\r\n`，剩余字节 `unshift` 回 socket（TLS 握手字节可能同包到达）；③ 直连兜底强制 IPv4，避免只有 AAAA 的域名先空耗 IPv6 超时。

## 设计说明

- **输出收口**：`safeJoin` 强制输出目录落在 `exec.agent.session.header.cwd`（会话工作区）内，越界抛错。
- **路径即用**：`huntStandalone(..., relBase)` 让 `files[].path` 始终是工作区相对路径（`images/cat/01.jpg`），可直接喂给 `read_image` / HTML / `present`。
- **UI 走内核**：图片登记为 attachment（`ctx.attachments.saveImage`），`output.render` 返回 `{type:"image", attachment}` 块；`@deepseek-ai/dsh-client-ui-tool` 自带 image card，无需客户端半。附件名必须 ASCII。
- **meta 尺寸以文件为准**：各源接口给的 width/height 是索引元数据，常与真下载的文件不一致（实测 Yandex 报 2844×1600、文件 2730×1536）。下载后读字节头（jpeg/png/webp）写 `width`/`height`，接口值另存 `metaWidth`/`metaHeight`。
- **落盘按文件头判格式**：`sniffExt` —— safebooru 的 `file_url` 后缀常是 `.jpg` 实际是 PNG，content-type 也不总对。
- **多源并行 + 轮转交错**：各源并行搜，结果按源轮转合并，避免前 N 张被单个源占满。

## 已知限制

| 站点 | 情况 |
|---|---|
| Google 图片 | `tbm=isch` 只回约 92KB 的 JS 壳，`AF_initDataCallback` / `encrypted-tbn` 计数为 0；`gbv=1` 仅 2KB；旧 async 接口 400。抓不动。 |
| 搜狗图片 | napi 返回 `{"status":1,"info":"forbid"}`，带 cookie 仍 forbid。 |
| X / Instagram | 未登录壳页 + 风控。正路是用 BrowserSkill 复用真实浏览器登录态。 |

替代方案：DuckDuckGo / Yandex 本身聚合 Google / Bing 结果，多数场景已覆盖。

## 合规与免责

- 本插件只做「按公开接口检索 + 下载」，**不绕过任何登录、付费墙或防盗链机制**，不提供任何图片的授权。
- 抓到的图片**版权归原作者 / 原站点所有**。仓库 License（MIT）只覆盖代码，**不覆盖通过本工具获取的任何图片**。
- 自用（个人欣赏、内部文档、学习）请遵守各站点服务条款；**对外发布、商用、二次分发前，请自行确认授权**（`engine:"cc"` 的 Openverse / Wikimedia 结果会在 `meta.json` 里带 license 字段，可作起点）。
- 请不要高频猛刷：各源都有速率限制，被封是使用者的责任。

## 贡献 / 反馈

- Bug、抓取失效（站点改版很常见）：开 [issue](https://github.com/fomalhaut1998/dsh-image-hunt/issues)，附上 `engine`、关键词、`errors` 里的原文。
- 想加图源：新的 `srcXxx(query, want)` + 在 `SOURCES` 注册一条 + 若是国外站标 `foreign:true`，参照现有源的写法即可。
- 提交前请确认不引入运行时依赖（本项目坚持零依赖）。

## License

MIT © fomalhaut1998
