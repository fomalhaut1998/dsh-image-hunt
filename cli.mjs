#!/usr/bin/env node
// dsh-image-hunt 的独立 CLI：不装 DSH 插件也能搜图 + 下载。
// 实现与插件同一份：index.js（这里只调纯函数 huntStandalone，不触碰 DSH 运行时）。
//
// node cli.mjs "<关键词>" [--n 8] [--engine anime] [--sources huaban,duitang]
//                          [--out images] [--min-pixels 1200]
//                          [--collection simple-icons] [--color "#fff"] [--noai]
//
// 国外源自动走代理：IMAGE_HUNT_PROXY / HTTPS_PROXY / HTTP_PROXY，默认 http://127.0.0.1:7890。
import path from "node:path";
import { huntStandalone, resolveSources, SOURCES } from "./index.js";

const USAGE = [
  "用法: node cli.mjs \"<关键词>\" [选项]",
  "",
  "  --n <1-40>           下载张数，默认 8",
  "  --engine <名字>      单个源 id 或别名（auto/all/both/intl/cc/anime/moe/icons），默认 auto",
  "  --sources <a,b>      直接列源，覆盖 --engine",
  "  --out <目录>         输出根目录，默认 images",
  "  --min-pixels <数字>  长边下限，0 = 不过滤",
  "  --collection <名字>  icons 专用图标集",
  "  --color <颜色>       icons 专用，给 SVG 上色",
  "  --noai               只要非 AI 图（仅 pixiv）",
  "  -h, --help           显示本帮助",
  "",
  "可用源: " + SOURCES.map((s) => s.id).join(", "),
].join("\n");

const argv = process.argv.slice(2);
if (!argv.length || argv.includes("-h") || argv.includes("--help")) {
  console.log(USAGE);
  process.exit(argv.length ? 0 : 1);
}

const query = argv[0];
const rest = argv.slice(1);
const flag = (name) => rest.indexOf("--" + name);
const value = (name, fallback) => {
  const i = flag(name);
  if (i < 0) return fallback;
  const v = rest[i + 1];
  if (v === undefined || v.startsWith("--")) {
    console.error("参数 --" + name + " 缺少取值");
    process.exit(1);
  }
  return v;
};
const has = (name) => flag(name) >= 0;

const engine = value("engine", "auto");
const sources = value("sources", "");
const count = Number(value("n", "8"));
const minPixels = Number(value("min-pixels", "0"));
const outRoot = value("out", "images");

// 先校验 engine / sources，别等到网络请求都发出去了才报错
try {
  resolveSources(sources ? sources.split(",").map((s) => s.trim()).filter(Boolean) : engine);
} catch (err) {
  console.error(String(err && err.message || err));
  console.error(USAGE);
  process.exit(1);
}

const cwd = process.cwd();
const res = await huntStandalone(query, {
  count: Number.isFinite(count) ? Math.min(40, Math.max(1, count)) : 8,
  engine,
  sources: sources ? sources.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
  outRoot: path.resolve(cwd, outRoot),
  minPixels: Number.isFinite(minPixels) ? minPixels : 0,
  collection: value("collection", undefined),
  color: value("color", undefined),
  noAI: has("noai"),
  relBase: cwd,
});

console.log(JSON.stringify({
  dir: path.relative(cwd, res.dir).split(path.sep).join("/") || ".",
  downloaded: res.downloaded,
  candidates: res.candidates,
  skipped: res.skipped,
  sources: res.files.map((f) => f.source),
  files: res.files.map((f) => f.path),
  errors: res.errors,
}, null, 2));

if (!res.downloaded) process.exit(1);
