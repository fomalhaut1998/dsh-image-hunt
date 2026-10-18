# dsh-image-hunt

多图源搜图 → 下载进当前会话工作区 → 图片直接在对话里显示。**DeepSeek Harness 宿主插件，零外部依赖。**

[English](README.en.md) · [更新日志](CHANGELOG.md)

- 19 个图源：国内 5 个、国外 8 个、二次元 4 个，另有 2 个图标相关组合
- 三个工具：`image_hunt`（搜+下+显示）、`image_search`（只搜）、`image_download`（已知直链落盘）
- 每张图都写 `meta.json`：原图直链、来源页、标题、**真实像素**、来源站中文名、授权信息
- 国外源自动走本机代理（插件内建 CONNECT 隧道，不依赖宿主环境变量）；国内源照旧直连

## 安装

```sh
# 从 GitHub 装（推荐，无需发布到 npm）
dsh plugin --profile web add github:fomalhaut1998/dsh-image-hunt

# 或本地开发：把本仓库 link 进 profile
#   ~/.dsh/profiles/<profile>/package.json
#   dependencies["dsh-image-hunt"] = "link:/path/to/dsh-image-hunt"
#   并把 "dsh-image-hunt" 加进 dsh.profile.bundles
```

装完**重启 DSH**（宿主会缓存 ESM 模块，改完 `index.js` 也必须重启才生效）。

卸载：`dsh plugin --profile web remove dsh-image-hunt`。

## 图源（engine / sources）

| id | 站点 | 适合 | 实测 |
|---|---|---|---|
| auto（默认） | 百度 + 360 + Bing | 中文综合，最快的组合 | 三源轮转交错 |
| baidu | 百度图片 | 中文语义最强、带来源标题 | 60 候选/查询 |
| bing | Bing 图片（www → cn 自动兜底） | 国际原图直链多 | 70 候选/查询 |
| so360 | 360 图片 | 量最大、速度快、有尺寸 | 259 候选/查询 |
| duitang | 堆糖 | 插画 / 头像 / 手账 / 手机壁纸 | 47 候选/查询 |
| huaban | 花瓣 | 设计 / 家居 / 摄影 / 灵感图 | 40 候选/查询 |
| icons | Iconify 图标库 | SVG 图标、品牌 logo（可改色） | 40 候选/查询 |
| all | 以上全部图片源 | 要"什么都来一点" | 270~371 候选/查询 |
| duckduckgo | DuckDuckGo 图片 | 国际图，免 key | 99 候选 |
| yandex | Yandex 图片 | 原图直链质量高，含 Pinterest 原图 | 60 候选 |
| openverse | Openverse | CC 授权图库聚合，带 license | 60 候选 |
| wikimedia | Wikimedia Commons | 维基共享资源，多数需署名 | 40 候选 |
| intl | duckduckgo + yandex + bing | 国外综合 | 三源轮转 |
| cc | openverse + wikimedia | 只要带授权/可商用的图 | 两源轮转 |
| pixiv | Pixiv | 二次元原创/同人，画师原图（PNG 可达 4313x3541） | 82 候选 |
| wallhaven | Wallhaven | 二次元壁纸，SFW，高分辨率 | 48~96 候选 |
| konachan | Konachan | 二次元插画，按评分排序，质量稳 | 44 候选 |
| safebooru | Safebooru | 二次元图库量最大，但多是合辑/拼贴 | 100 候选 |
| anime | pixiv + wallhaven + konachan | 二次元综合（推荐） | 三源轮转 |
| moe | anime + safebooru | 二次元要量 | 四源轮转 |

- `sources:["duitang","huaban"]` 可任意混用。
- `engine:"icons"` + `collection:"simple-icons"` = 品牌 logo（CC0）；mdi / tabler / logos / ph 同理；`color:"#ffffff"` 给 SVG 上色。
- **国外源走代理**：duckduckgo / yandex / openverse / wikimedia / pixiv / wallhaven / konachan / safebooru 标记为 foreign，只有它们经代理。

### 二次元源的三个特性

1. pixiv 下载时会用 `/ajax/illust/<id>` 换成**原图**，画师写进 meta 的 `license`（形如 `Pixiv · @作者`），AI 图另标 `AI 生成`；
2. booru 系（konachan / safebooru）**只认英文 tag**，中文词走内置映射（宫崎骏/吉卜力→ghibli、龙猫→totoro、千与千寻→spirited_away…），映射不到的中文词会被丢掉并报错；
3. `noAI:true` 只要非 AI 图（仅 pixiv 生效，实测过滤后 aiType 全为 1）。

> 想找**纯景背景**（无人物），在 safebooru / konachan 上组合 `no_humans` + 主题词，比自由词有效得多。pixiv 是角色本位，搜风景基本不可用。

## 代理（只给国外源用）

插件内建 CONNECT 隧道，无需宿主环境变量。

- 解析顺序：`IMAGE_HUNT_PROXY` → `HTTPS_PROXY`/`https_proxy` → `HTTP_PROXY`/`http_proxy`；值取 `off`/`none`/`no`/`0`/`false` 表示关闭；缺省 `http://127.0.0.1:7890`。
- 代理不通 → 60s 熔断 + 自动退回直连（国外源此时多半超时）；`proxyErrors` 保留最近 20 条失败原因（url/error/code/addrs）供诊断。
- 三个必踩的坑：① 把连好的 socket 塞进 `http.request` 的 `createConnection` 会被隐式默认 Agent 忽略，请求绕开隧道直连 → 必须自建 `new Agent({keepAlive:false,maxSockets:1})` 并覆写其 `createConnection`；② CONNECT 响应要累积到 `\r\n\r\n`，剩余字节 `unshift` 回 socket（TLS 握手字节可能同包到达）；③ 直连兜底强制 IPv4，避免只有 AAAA 的域名先空耗 IPv6 超时。

## 工具

| 工具 | 作用 |
|---|---|
| `image_hunt` | 搜 + 下 + 显示。落 `images/<关键词>/`，同目录写 `meta.json`（原图直链/来源页/标题/尺寸/license） |
| `image_search` | 只搜不下载，返回候选（含图源），先挑后下 |
| `image_download` | 已知直链落盘（可带 referer 过防盗链；`proxy:true` 让这条直链走代理；SVG 只落盘不入附件） |

一次 `image_hunt` 返回的形状：

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

## 关键设计

- **输出收口**：`safeJoin` 强制输出目录落在 `exec.agent.session.header.cwd`（会话工作区）内，越界抛错。
- **文件路径基准**：`huntStandalone(..., relBase)` —— 工具层传会话工作区，所以 `files[].path` 始终是可用的工作区相对路径（如 `images/cat/01.jpg`）。
- **UI 走内核**：图片登记为 attachment（`ctx.attachments.saveImage`），`output.render` 返回 `{type:'image', attachment}` 块；`@deepseek-ai/dsh-client-ui-tool` 自带 image card，无需客户端半。附件名必须 ASCII。
- **meta 尺寸以文件为准**：各源接口给的 width/height 是索引元数据，经常与真下载下来的文件不一致（实测 Yandex 报 2844x1600、文件 2730x1536）。下载后读字节头（jpeg/png/webp）写 `width`/`height`，接口值另存 `metaWidth`/`metaHeight`。
- **落盘按文件头判格式**：`sniffExt` —— safebooru 的 `file_url` 后缀常是 .jpg 实际是 png，content-type 也不总对。
- **多源并行 + 轮转交错**：各源并行搜，结果按源轮转合并，避免前 N 张被单个源占满。

## 已知限制

| 站点 | 情况 |
|---|---|
| Google 图片 | `tbm=isch` 只回约 92KB 的 JS 壳，`AF_initDataCallback` / `encrypted-tbn` 计数为 0；`gbv=1` 仅 2KB；旧 async 接口 400。抓不动。 |
| 搜狗图片 | napi 返回 `{"status":1,"info":"forbid"}`，带 cookie 仍 forbid。 |
| X / Instagram | 未登录壳页 + 风控。正路是用 BrowserSkill 复用真实浏览器登录态。 |

替代方案：DuckDuckGo / Yandex 本身聚合 Google / Bing 结果，多数场景已覆盖。

## License

MIT
