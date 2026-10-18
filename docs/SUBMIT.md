# 投递到 DSH 插件社区（awesome-dsh-plugin）

目标仓库：<https://github.com/awesome-dsh-plugin/awesome-dsh-plugin>
规则来源：<https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md>

## 硬性门槛（自查）

| 要求 | 现状 |
|---|---|
| 仓库声明 `dsh.bundle` manifest | ✅ `package.json` → `dsh.bundle.patch`，旁边有 `cordis.patch.yml` |
| 仓库有真实可用的代码 | ✅ `index.js`（54 KB，19 个图源、3 个工具） |
| 仓库创建满 **1 天**（CI 自动检查） | ⏳ 仓库建于 2026-10-18T09:45Z，**2026-10-19 之后**才满足 |
| 加了 `dsh-plugin` topic | ✅ |
| 持续维护 | ✅ |

## 提交内容（**只加一个文件**）

路径：`data/plugins/fomalhaut1998__dsh-image-hunt.yml`

内容（与本仓库 `docs/awesome-entry.yml` 一致）：

```yaml
url: https://github.com/fomalhaut1998/dsh-image-hunt
name: fomalhaut1998/dsh-image-hunt
category: tools
description:
  en: Multi-source image search and download (19 engines across Baidu, Bing, 360, Duitang, Huaban, DuckDuckGo, Yandex, Openverse, Wikimedia, Pixiv, Wallhaven, Konachan, Safebooru and Iconify) that saves results into the session workspace with a per-file meta.json and renders them inline in the conversation.
  zh: 多图源搜图并下载（19 个图源，覆盖百度/必应/360/堆糖/花瓣/DuckDuckGo/Yandex/Openverse/维基共享/Pixiv/Wallhaven/Konachan/Safebooru/Iconify），落盘进会话工作区、逐张写 meta.json，图片直接在对话里显示。
```

> README 不用动：列表由 `data/plugins/*.yml` 自动生成。
> 描述里若含半角 `: ` 必须加引号（本条没有）。

## 操作步骤

```sh
# 1. fork（或用网页 Fork）
gh repo fork awesome-dsh-plugin/awesome-dsh-plugin --clone=true --remote=false
cd awesome-dsh-plugin

# 2. 建分支 + 放文件
git checkout -b add-fomalhaut1998-dsh-image-hunt
mkdir -p data/plugins
curl -sL https://raw.githubusercontent.com/fomalhaut1998/dsh-image-hunt/main/docs/awesome-entry.yml \
  -o data/plugins/fomalhaut1998__dsh-image-hunt.yml

# 3. 提交并开 PR
git add data/plugins/fomalhaut1998__dsh-image-hunt.yml
git commit -m "Add fomalhaut1998/dsh-image-hunt"
git push -u origin add-fomalhaut1998-dsh-image-hunt
gh pr create --repo awesome-dsh-plugin/awesome-dsh-plugin \
  --title "Add fomalhaut1998/dsh-image-hunt" \
  --body "Multi-source image search & download for DSH — 19 engines, workspace confinement, inline rendering. Declares `dsh.bundle` and ships `cordis.patch.yml`."
```

## PR 描述模板

```markdown
### What it is

`dsh-image-hunt` registers three tools (`image_hunt` / `image_search` / `image_download`) plus an inline skill:

- 19 engines: Baidu, Bing, 360, Duitang, Huaban, Iconify (direct) and DuckDuckGo, Yandex, Openverse, Wikimedia, Pixiv, Wallhaven, Konachan, Safebooru (through a built-in CONNECT tunnel, so no host env vars are needed).
- Downloads land inside the session workspace (`safeJoin`), one `meta.json` per batch with source page, title, real pixel size and license.
- Images are returned as `{type:'image', attachment}` blocks, so the stock tool card renders them — no client half.
- Pixel sizes are read from file headers and formats are sniffed from magic bytes (several boorus serve a `.jpg` URL whose bytes are PNG).

Install check: `dsh plugin --profile web add github:fomalhaut1998/dsh-image-hunt`

Repo declares `dsh.bundle` + `cordis.patch.yml`; MIT.
```
