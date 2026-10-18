// dsh-image-hunt v1.4.1 — 多图源搜图（国内源直连 / 国外源走本机代理）→ 下载进会话工作区 → 结果在对话里直接出图
// v1.4：加二次元图源 pixiv / wallhaven / konachan / safebooru（engine=anime），pixiv 原图 + noAI 过滤，落盘按文件头判格式
// v1.4.1：文档重写（图源数字/参数表/免责）+ 仓库根 cli.mjs 独立 CLI；未知图源的报错改为按 ALIAS 动态列别名
// 宿主半：注册 3 个工具 (image_hunt / image_search / image_download) + 1 个内联 skill。
// 零外部依赖：原生 fetch + node:fs。二进制写只允许落在会话工作区内（工具层 safeJoin 收口）。
// 图源实现同时被工作区脚本 tools/image-hunt/lib.mjs 复用（它只做 re-export，避免两份实现漂移）。
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import tls from 'node:tls'
import httpMod from 'node:http'
import httpsMod from 'node:https'
import zlib from 'node:zlib'

export const name = 'image-hunt'
export const inject = ['tools', 'skills', 'attachments']

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const MAX_BYTES = 40 * 1024 * 1024
const ENT = { '&quot;': '"', '&amp;': '&', '&#39;': "'", '&lt;': '<', '&gt;': '>' }
// 站名映射：交付给用户时要写清来源站点（只给内部 engine key 用户看不懂）
const SITE_NAMES = { baidu: '百度图片', bing: '必应图片', so360: '360图片', duitang: '堆糖', huaban: '花瓣网', icons: 'Iconify',
  duckduckgo: 'DuckDuckGo 图片', yandex: 'Yandex 图片', openverse: 'Openverse', wikimedia: '维基共享资源',
  pixiv: 'Pixiv', wallhaven: 'Wallhaven', konachan: 'Konachan', safebooru: 'Safebooru' }
const siteOf = (e) => SITE_NAMES[String(e).replace(/:thumb$/, '')] || String(e)
const decodeEnt = (s) => s.replace(/&quot;|&amp;|&#39;|&lt;|&gt;/g, (m) => ENT[m])

/**
 * 从下载到的字节里读真实像素尺寸。
 * 教训（v1.3 实测）：各图源的 width/height 是搜索索引/接口给的元数据，跟真正下下来的文件经常不一致
 * —— Yandex 报 2844x1600 下来 2730x1536；Wikimedia 报 2000x1333（缩略图尺寸）下来却是 3000x2000 原图。
 * 所以 meta.json 一律以文件本身为准，元数据只另存 metaWidth/metaHeight 备查。
 */
function imgSize(b) {
  if (!b || b.length < 24) return null
  if (b.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    while (i < b.length - 9) {
      if (b[i] !== 0xff) { i += 1; continue }
      const m = b[i + 1]
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) }
      i += 2 + b.readUInt16BE(i + 2)
    }
    return null
  }
  if (b.length > 30 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP') {
    const t = b.subarray(12, 16).toString('ascii')
    if (t === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) }
    if (t === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff }
    if (t === 'VP8L') { const v = b.readUInt32LE(21); return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 } }
  }
  return null
}

/** meta 里记「文件真实尺寸」；接口给的元数据放 metaWidth/metaHeight */
function dimFields(bytes, fw, fh) {
  const s = imgSize(bytes)
  return s ? { width: s.w, height: s.h, metaWidth: fw, metaHeight: fh } : { width: fw, height: fh }
}

/**
 * 宽松 JSON 解析（百度这两类脏数据都实测遇到过）：
 * 1) 原样；2) 字符串内嵌原始控制字符（如 TAB）→ 换成空格；3) 非法转义 \\' → '。
 * 三级都失败就抛出，由调用方退到正则兜底。
 */
function parseLoose(text) {
  const s = String(text)
  try { return JSON.parse(s) } catch { /* 下一级 */ }
  const cleaned = s.replace(/[\u0000-\u001f]/g, ' ')
  try { return JSON.parse(cleaned) } catch { /* 下一级 */ }
  return JSON.parse(cleaned.replace(/\\'/g, "'"))
}

export function slugify(q, max = 48) {
  const s = String(q).trim().replace(/[\\/:*?"<>|\s]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return (s || 'query').slice(0, max)
}

const https = (u) => (typeof u === 'string' && u.startsWith('http://') ? 'https://' + u.slice(7) : u)
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

// ───────────────────────── 代理层（只给国外图源用） ─────────────────────────
// Node 的 fetch 默认不读 HTTP_PROXY，所以这里自带「CONNECT 隧道 + 手动 HTTP/1.1」实现。
// 国外源走它，国内源始终直连；代理不可用（未开/端口不对）时自动退回直连，不影响国内源。
let PROXY = (() => {
  const raw = process.env.IMAGE_HUNT_PROXY || process.env.HTTPS_PROXY || process.env.https_proxy
    || process.env.HTTP_PROXY || process.env.http_proxy || ''
  if (/^(off|none|no|0|false)$/i.test(String(raw).trim())) return null
  return String(raw).trim() || 'http://127.0.0.1:7890'
})()
let proxyDeadUntil = 0
/** 最近的代理失败记录（诊断用，最多留 20 条） */
export const proxyErrors = []

/** 覆盖代理设置：setProxy('http://127.0.0.1:7890') / setProxy(null) 关闭 */
export function setProxy(v) { PROXY = v ? String(v) : null; proxyDeadUntil = 0 }
export function getProxy() { return PROXY }

function proxyEndpoint() {
  if (!PROXY) return null
  try {
    const u = new URL(PROXY.includes('://') ? PROXY : 'http://' + PROXY)
    return { host: u.hostname, port: Number(u.port || 7890),
      auth: u.username ? 'Basic ' + Buffer.from(decodeURIComponent(u.username) + ':' + decodeURIComponent(u.password)).toString('base64') : '' }
  } catch { return null }
}

/** 裸 GET（支持 CONNECT 隧道），返回 fetch 风格的最小 Response */
/** 经 HTTP 代理打开到 host:port 的隧道（CONNECT），HTTPS 再套一层 TLS。任何 socket 都挂了 error 监听，避免握手失败冒成未捕获异常 */
function openTunnel(host, port, isTls, viaProxy, bail) {
  return new Promise((resolve) => {
    const s = net.connect({ host: viaProxy.host, port: viaProxy.port })
    let head = Buffer.alloc(0)
    s.on('error', (e) => { bail(e); resolve(null) })
    s.on('connect', () => {
      s.write('CONNECT ' + host + ':' + port + ' HTTP/1.1\r\nHost: ' + host + ':' + port + '\r\n'
        + (viaProxy.auth ? 'Proxy-Authorization: ' + viaProxy.auth + '\r\n' : '') + 'Proxy-Connection: keep-alive\r\n\r\n')
    })
    const onData = (d) => {
      head = Buffer.concat([head, d])
      const cut = head.indexOf('\r\n\r\n')
      if (cut < 0) {
        if (head.length > 8192) { s.destroy(); bail(new Error('代理响应头过大')); resolve(null) }
        return
      }
      s.removeListener('data', onData)
      const first = head.toString('utf8', 0, cut).split('\r\n')[0]
      const rest = head.subarray(cut + 4)
      if (!/^HTTP\/1\.[01] 200/.test(first)) { s.destroy(); bail(new Error('代理 CONNECT 失败: ' + first)); return resolve(null) }
      if (rest.length) s.unshift(rest)   // TLS 握手字节可能已随 CONNECT 响应到达，必须回推
      if (!isTls) return resolve(s)
      const t = tls.connect({ socket: s, servername: host })
      t.on('error', (e) => { bail(e); resolve(null) })
      t.once('secureConnect', () => resolve(t))
    }
    s.on('data', onData)
  })
}

/** 裸 GET（可走 CONNECT 隧道），返回 fetch 风格的最小 Response */
export function rawGet(url, opts = {}) {
  const { headers = {}, timeout = 25000, viaProxy = null, depth = 0 } = opts
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const isTls = u.protocol === 'https:'
    const targetPort = Number(u.port || (isTls ? 443 : 80))
    const reqHeaders = { Host: u.host, 'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8', 'Accept-Encoding': 'gzip, deflate, br', Connection: 'close', ...headers }
    let settled = false
    const timer = setTimeout(() => bail(new Error('timeout ' + timeout + 'ms')), timeout)
    function bail(e) { if (!settled) { settled = true; clearTimeout(timer); reject(e) } }

    const onRes = (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('error', bail)
      res.on('end', () => {
        if (settled) return
        let body = Buffer.concat(chunks)
        const enc = String(res.headers['content-encoding'] || '')
        try {
          if (enc.includes('br')) body = zlib.brotliDecompressSync(body)
          else if (enc.includes('gzip')) body = zlib.gunzipSync(body)
          else if (enc.includes('deflate')) body = zlib.inflateSync(body)
        } catch { /* 解不开就用原始字节 */ }
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && depth < 4) {
          return rawGet(new URL(res.headers.location, url).toString(), { ...opts, depth: depth + 1 }).then(resolve, reject)
        }
        settled = true
        clearTimeout(timer)
        const h = new Map(Object.entries(res.headers).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v.join(', ') : String(v)]))
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode,
          headers: { get: (n) => (h.has(String(n).toLowerCase()) ? h.get(String(n).toLowerCase()) : null) },
          text: async () => body.toString('utf8'), arrayBuffer: async () => new Uint8Array(body).buffer, bytes: body })
      })
    }

    const start = async () => {
      const sock = viaProxy ? await openTunnel(u.hostname, targetPort, isTls, viaProxy, bail) : null
      if (viaProxy && !sock) return
      const lib = isTls ? httpsMod : httpMod
      const reqOpts = { host: u.hostname, port: targetPort, path: u.pathname + u.search, method: 'GET', headers: reqHeaders }
      if (sock) {
        // 关键：已经连好的 socket 要通过 Agent 的 createConnection 交出去。
        // 直接写 createConnection 到 request 选项会被默认 Agent 忽略 → 请求会绕开隧道直连目标（在国内就是 ETIMEDOUT）。
        const agent = new lib.Agent({ keepAlive: false, maxSockets: 1 })
        agent.createConnection = (_o, cb) => { cb(null, sock); return sock }
        reqOpts.agent = agent
      } else {
        reqOpts.agent = false
      }
      const req = lib.request(reqOpts, onRes)
      req.on('error', bail)
      req.setTimeout(timeout, () => req.destroy(new Error('timeout ' + timeout + 'ms')))
      req.end()
    }
    start().catch(bail)
  })
}

/** fetch 风格入口：proxy=true 时优先走代理，代理不可用自动退回直连 */
export async function request(url, opts = {}) {
  const { proxy = false, ...rest } = opts
  const ep = proxy ? proxyEndpoint() : null
  if (ep && Date.now() > proxyDeadUntil) {
    try { return await rawGet(url, { ...rest, viaProxy: ep }) }
    catch (e) {
      const msg = String(e && e.message || e)
      if (proxyErrors.length < 20) proxyErrors.push({ url: String(url).slice(0, 110), error: msg,
        code: e && e.code, addrs: e && e.errors ? e.errors.map((x) => ((x.syscall || '') + ' ' + (x.address || '') + ' ' + (x.code || ''))).join(' | ') : undefined })
      if (/代理 CONNECT|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|timeout/i.test(msg)) proxyDeadUntil = Date.now() + 60000
    }
  }
  return rawGet(url, rest)
}

async function getJson(url, opts = {}) {
  if (opts.proxy) {
    const r = await request(url, { proxy: true, timeout: opts.timeout || 25000,
      headers: { Accept: 'application/json, text/plain, */*', ...(opts.headers || {}) } })
    if (!r.ok) throw new Error('HTTP ' + r.status)
    return parseLoose(await r.text())
  }
  const r = await fetch(url, { headers: { 'User-Agent': UA, ...(opts.headers || {}) }, signal: AbortSignal.timeout(opts.timeout || 20000) })
  if (!r.ok) throw new Error('HTTP ' + r.status)
  return parseLoose(await r.text())
}

// ───────────────────────── 图源实现 ─────────────────────────
// 每个源返回统一候选：{ engine, thumb, full, page, title, width, height, referer, license? }

/** 百度行的解析：先严格解析；一旦遇到非法转义（实测有 \\x）整份 JSON 会崩，退到正则抽字段 */
function baiduRows(text) {
  try {
    const j = parseLoose(text)
    if (j && Array.isArray(j.data)) return j.data.filter((d) => d && (d.thumbURL || d.middleURL))
  } catch { /* 落到正则兜底 */ }
  const unesc = (s) => String(s)
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\\//g, '/')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    .replace(/\\+$/, '')
  const rows = []
  for (const chunk of String(text).split('"thumbURL"').slice(1)) {
    const win = chunk.slice(0, 6000)
    const pick = (re) => { const m = re.exec(win); return m ? m[1] : '' }
    const objurl = pick(/"ObjURL"\s*:\s*"([^"]+)"/) || pick(/"ObjUrl"\s*:\s*"([^"]+)"/)
    rows.push({
      thumbURL: unesc(pick(/^\s*:\s*"([^"]+)"/)),
      middleURL: unesc(pick(/"middleURL"\s*:\s*"([^"]+)"/)),
      hoverURL: unesc(pick(/"hoverURL"\s*:\s*"([^"]+)"/)),
      width: Number(pick(/"width"\s*:\s*(\d+)/)) || 0,
      height: Number(pick(/"height"\s*:\s*(\d+)/)) || 0,
      fromPageTitleEnc: unesc(pick(/"fromPageTitleEnc"\s*:\s*"([^"]*)"/)),
      replaceUrl: objurl ? [{ ObjURL: objurl }] : null,
    })
  }
  return rows.filter((d) => d.thumbURL || d.middleURL)
}

async function srcBaidu(query, want) {
  const out = []
  for (let pn = 0; pn < want && out.length < want; pn += 30) {
    const url = 'https://image.baidu.com/search/acjson?tn=resultjson_com&ipn=rj&ct=201326592&fp=result&word='
      + encodeURIComponent(query) + '&pn=' + pn + '&rn=30&ie=utf-8'
    const r = await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://image.baidu.com/' }, signal: AbortSignal.timeout(20000) })
    if (!r.ok) throw new Error('HTTP ' + r.status)
    const rows = baiduRows(await r.text())
    if (!rows.length) break
    for (const d of rows) {
      const repl = Array.isArray(d.replaceUrl) ? d.replaceUrl.find((x) => x && (x.ObjURL || x.ObjUrl)) : null
      let full = repl ? decodeURIComponent(repl.ObjURL || repl.ObjUrl) : (d.middleURL || d.hoverURL)
      if (!full || !/^https?:\/\/[^\s\\]+$/.test(full)) full = d.thumbURL
      if (!full || !/^https?:\/\/[^\s\\]+$/.test(full)) full = d.middleURL || d.hoverURL
      out.push({ engine: 'baidu', thumb: d.thumbURL || '', full, page: d.fromURL || '',
        title: d.fromPageTitleEnc || (repl && repl.FromPageTitleEnc) || '', width: num(d.width), height: num(d.height),
        referer: 'https://image.baidu.com/' })
    }
  }
  return out
}

async function srcBing(query, want, opts = {}) {
  const out = []
  const hosts = opts.proxy ? ['https://www.bing.com', 'https://cn.bing.com'] : ['https://cn.bing.com']
  for (let first = 0; first < want; first += 35) {
    let html = ''
    let usedProxy = false
    for (const host of hosts) {
      const intl = host.includes('www.bing.com')
      const url = host + '/images/async?q=' + encodeURIComponent(query) + '&first=' + first + '&count=35&mmasync=1'
      try {
        const r = intl
          ? await request(url, { proxy: true, timeout: 20000, headers: { 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' } })
          : await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' }, signal: AbortSignal.timeout(20000) })
        if (!r.ok) continue
        html = await r.text()
        if (html.includes('iusc')) { usedProxy = intl; break }
      } catch { /* 换下一个 host */ }
    }
    if (!html) break
    const before = out.length
    for (const m of html.matchAll(/class="iusc"[^>]*?m="([^"]+)"/g)) {
      try {
        const j = JSON.parse(decodeEnt(m[1]))
        if (!j.murl) continue
        out.push({ engine: 'bing', thumb: j.turl || '', full: j.murl, page: j.purl || '', title: j.t || '',
          width: 0, height: 0, referer: '', ...(usedProxy ? { proxy: true } : {}) })
      } catch { /* malformed */ }
    }
    if (out.length === before) break
  }
  return out
}

async function src360(query, want) {
  const out = []
  for (let sn = 0; sn < want && out.length < want; sn += 60) {
    const url = 'https://image.so.com/j?q=' + encodeURIComponent(query) + '&src=srp&sn=' + sn + '&pn=60'
    const j = await getJson(url, { headers: { Referer: 'https://image.so.com/' } })
    const list = j.list || []
    if (!list.length) break
    for (const it of list) {
      const full = https(it.thumb_bak || it.thumb || it.img)
      if (!full) continue
      out.push({ engine: 'so360', thumb: https(it.thumb || it.thumb_bak || it.img), full,
        page: it.link || it.comm_purl || it.dspurl || '', title: it.title || it.litetitle || '',
        width: num(it.width), height: num(it.height), referer: 'https://image.so.com/' })
    }
  }
  return out
}

async function srcDuitang(query, want) {
  const out = []
  for (let start = 0; start < want && out.length < want; start += 24) {
    const url = 'https://www.duitang.com/napi/blog/list/by_search/?kw=' + encodeURIComponent(query) + '&start=' + start + '&limit=24'
    const j = await getJson(url, { headers: { Referer: 'https://www.duitang.com/' } })
    const rows = (j.data && j.data.object_list) || []
    if (!rows.length) break
    for (const it of rows) {
      const ph = it.photo || {}
      if (!ph.path) continue
      out.push({ engine: 'duitang', thumb: ph.path, full: https(ph.path),
        page: it.id ? 'https://www.duitang.com/blog/?id=' + it.id : '', title: it.msg || '',
        width: num(ph.width), height: num(ph.height), referer: 'https://www.duitang.com/' })
    }
  }
  return out
}

async function srcHuaban(query, want) {
  const out = []
  for (let page = 1; page <= 2 && out.length < want; page++) {
    const url = 'https://huaban.com/v3/search/images?q=' + encodeURIComponent(query) + '&limit=20&page=' + page
    const j = await getJson(url, { headers: { Referer: 'https://huaban.com/' } })
    const pins = j.pins || []
    if (!pins.length) break
    for (const p of pins) {
      const f = p.file || {}
      if (!f.url && !f.key) continue
      const full = f.url ? https(f.url) : 'https://hbimg.huabanimg.com/' + f.key
      out.push({ engine: 'huaban', thumb: full, full,
        page: p.pin_id ? 'https://huaban.com/pins/' + p.pin_id : '', title: String(p.raw_text || '').slice(0, 120),
        width: num(f.width), height: num(f.height), referer: 'https://huaban.com/' })
    }
  }
  return out
}

/** 图标源：Iconify 聚合 200+ 图标集（SVG 矢量，可改色）。collection 例：simple-icons(品牌 logo)/mdi/tabler/logos/ph */
async function srcIcons(query, want, { collection, color } = {}) {
  const url = 'https://api.iconify.design/search?query=' + encodeURIComponent(query) + '&limit=' + Math.min(want, 64)
    + (collection ? '&prefixes=' + encodeURIComponent(collection) : '')
  const j = await getJson(url)
  const names = (j.icons || []).slice(0, want)
  return names.map((n) => {
    const slash = String(n).replace(':', '/')
    return { engine: 'icons', thumb: '', full: 'https://api.iconify.design/' + slash + '.svg?height=512' + (color ? '&color=' + encodeURIComponent(color) : ''),
      page: 'https://icon-sets.iconify.design/' + String(n).replace(':', '/') + '/', title: String(n),
      width: 0, height: 0, referer: '', note: 'SVG 矢量图，可直接改色/放大',
      license: String(n).startsWith('simple-icons:') ? 'CC0（simple-icons 品牌图标）' : '见该图标集许可' }
  })
}

/** DuckDuckGo 图片：两步（HTML 取 vqd+cookie → i.js JSON）。结果聚合 Bing/Google 等，国外图多 */
async function srcDuckDuckGo(query, want) {
  const out = []
  const home = await request('https://duckduckgo.com/?q=' + encodeURIComponent(query) + '&iax=images&ia=images',
    { proxy: true, timeout: 30000, headers: { Accept: 'text/html,application/xhtml+xml' } })
  if (!home.ok) throw new Error('HTTP ' + home.status)
  const html = await home.text()
  const vqd = (/vqd=["']?([\d-]+)/.exec(html) || [])[1]
  if (!vqd) throw new Error('未取到 vqd（DuckDuckGo 可能要求验证码）')
  const cookies = (home.headers.get('set-cookie') || '').split(/,(?=\s*[A-Za-z0-9_-]+=)/).map((c) => c.split(';')[0]).join('; ')
  let next = ''
  for (let page = 1; page <= 3 && out.length < want; page++) {
    const url = 'https://duckduckgo.com/i.js?l=us-en&o=json&q=' + encodeURIComponent(query) + '&vqd=' + vqd
      + '&f=,,,,,&p=' + page + (next ? '&s=' + next : '')
    const r = await request(url, { proxy: true, timeout: 30000, headers: {
      Accept: 'application/json, text/javascript, */*; q=0.01', Referer: 'https://duckduckgo.com/',
      'X-Requested-With': 'XMLHttpRequest', 'Sec-Fetch-Dest': 'empty', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Site': 'same-origin',
      ...(cookies ? { Cookie: cookies } : {}) } })
    if (!r.ok) throw new Error('HTTP ' + r.status)
    const j = parseLoose(await r.text())
    const rows = j.results || []
    if (!rows.length) break
    for (const it of rows) {
      if (!it.image) continue
      out.push({ engine: 'duckduckgo', thumb: it.thumbnail || '', full: it.image, page: it.url || '',
        title: it.title || '', width: num(it.width), height: num(it.height),
        referer: 'https://duckduckgo.com/', proxy: true })
    }
    next = String(((j.next || '').match(/[?&]s=(\d+)/) || [])[1] || '')
    if (!next) break
  }
  return out
}

/** Yandex 图片：服务端渲染的 HTML 里带完整 JSON（HTML 实体转义），原图尺寸与来源页齐全 */
async function srcYandex(query, want) {
  const out = []
  for (let p = 0; p < 3 && out.length < want; p++) {
    const r = await request('https://yandex.com/images/search?text=' + encodeURIComponent(query) + '&p=' + p,
      { proxy: true, timeout: 35000, headers: { Accept: 'text/html,application/xhtml+xml' } })
    if (!r.ok) throw new Error('HTTP ' + r.status)
    const html = decodeEnt(await r.text())
    const before = out.length
    for (const m of html.matchAll(/"origUrl":"(https?:\/\/[^"]+)"/g)) {
      const full = m[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/')
      const win = html.slice(Math.max(0, m.index - 700), m.index)
      const lastOf = (re) => { const all = [...win.matchAll(new RegExp(re.source, 'g'))]; return all.length ? all[all.length - 1][1] : '' }
      out.push({ engine: 'yandex', thumb: '', full,
        page: lastOf(/"url":"(https?:\/\/[^"]+)"/),
        title: lastOf(/"title":"([^"]*)"/),
        width: num(lastOf(/"origWidth":(\d+)/) || lastOf(/"width":(\d+)/)),
        height: num(lastOf(/"origHeight":(\d+)/) || lastOf(/"height":(\d+)/)),
        referer: 'https://yandex.com/', proxy: true })
    }
    if (out.length === before) break
  }
  return out
}

/** Openverse（WordPress 基金会开源图库）：CC 授权、免 key，适合可商用素材 */
async function srcOpenverse(query, want) {
  const out = []
  for (let page = 1; page <= 3 && out.length < want; page++) {
    const j = await getJson('https://api.openverse.org/v1/images/?q=' + encodeURIComponent(query) + '&page_size=20&page=' + page + '&format=json',
      { proxy: true, timeout: 25000 })
    const rows = j.results || []
    if (!rows.length) break
    for (const it of rows) {
      const full = it.url || it.thumbnail
      if (!full) continue
      out.push({ engine: 'openverse', thumb: it.thumbnail || '', full, page: it.foreign_landing_url || '',
        title: it.title || '', width: num(it.width), height: num(it.height), referer: '', proxy: true,
        license: [it.license, it.license_version].filter(Boolean).join(' ').toUpperCase() + (it.creator ? ' · ' + it.creator : '') })
    }
  }
  return out
}

/** Wikimedia Commons：公有领域 / CC 素材，原图大，适合背景与实拍参考 */
async function srcWikimedia(query, want) {
  const url = 'https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=' + encodeURIComponent(query)
    + '&gsrnamespace=6&gsrlimit=' + Math.min(Math.max(want, 10), 40)
    + '&prop=imageinfo&iiprop=url%7Csize%7Cextmetadata&iiurlwidth=2000&format=json&origin=*'
  const j = await getJson(url, { proxy: true, timeout: 30000 })
  const pages = (j.query && j.query.pages) || {}
  const out = []
  for (const k of Object.keys(pages)) {
    const info = (pages[k].imageinfo || [])[0]
    if (!info || !info.url || /\.(svg|tif|tiff|pdf|ogv|webm)$/i.test(info.url)) continue
    const useThumb = info.width > 2000 && !!info.thumburl
    const full = useThumb ? info.thumburl : info.url
    // 记录的是「真正下载下来的那张」的尺寸，不是原图尺寸
    const w = num(useThumb && info.thumbwidth ? info.thumbwidth : info.width)
    const h = num(useThumb && info.thumbheight ? info.thumbheight : info.height)
    const meta = info.extmetadata || {}
    const lic = meta.LicenseShortName && meta.LicenseShortName.value
    out.push({ engine: 'wikimedia', thumb: info.thumburl || '', full,
      page: info.descriptionurl || '', title: String(meta.ObjectName ? meta.ObjectName.value : pages[k].title || '').slice(0, 120),
      width: w, height: h, referer: '', proxy: true,
      ...(lic ? { license: String(lic).replace(/<[^>]+>/g, '') } : {}) })
  }
  return out
}

// ───────────────────────── 二次元图源（v1.4）─────────────────────────

const PIXIV_HEADERS = { Referer: 'https://www.pixiv.net/', 'Accept-Language': 'zh-CN,zh;q=0.9' }

/**
 * 中文/日文关键词 → booru 站认的 ascii tag。
 * booru 系（konachan / safebooru）只按英文标签检索，中文词直接查会 0 结果，
 * 所以这里做一层常用映射；没命中又写不成 ascii 的词会被丢掉（让调用方知道要改英文）。
 */
const TAG_MAP = {
  宫崎骏: 'ghibli', '宮崎駿': 'ghibli', 吉卜力: 'ghibli', 'ジブリ': 'ghibli', 'スタジオジブリ': 'studio_ghibli',
  龙猫: 'totoro', 'となりのトトロ': 'totoro', 千与千寻: 'spirited_away', '千と千尋の神隠し': 'spirited_away',
  天空之城: 'laputa', '天空の城ラピュタ': 'laputa', 幽灵公主: 'mononoke_hime', 'もののけ姫': 'mononoke_hime',
  魔女宅急便: 'kiki', '魔女の宅急便': 'kiki', 哈尔的移动城堡: 'howl', 'ハウルの動く城': 'howl',
  风之谷: 'nausicaa', 起风了: 'kaze_tachinu', 红猪: 'porco_rosso', 悬崖上的金鱼姬: 'ponyo', '崖の上のポニョ': 'ponyo',
  初音未来: 'hatsune_miku', '初音ミク': 'hatsune_miku', 雷姆: 'rem_(re:zero)', 原神: 'genshin_impact',
  明日方舟: 'arknights', 风景: 'scenery', 少女: 'girl', 猫: 'cat', 龙: 'dragon',
}
function booruTags(query) {
  const parts = String(query || '').trim().split(/[\s,，、/]+/).filter(Boolean)
  const mapped = [], ascii = []
  for (const p of parts) {
    if (TAG_MAP[p]) mapped.push(TAG_MAP[p])
    else if (/^[A-Za-z0-9_():\-]+$/.test(p)) ascii.push(p.toLowerCase())
  }
  return (mapped.length ? mapped : ascii).join(' ')
}

/** Pixiv：免登录搜索接口，中文/日文标签都能搜；结果给 master1200 大图，原图另走 /ajax/illust/<id> */
export async function srcPixiv(query, want, opts = {}) {
  const out = [], seen = new Set()
  const noAI = opts.noAI === true
  for (const order of ['popular_d', 'date_d']) {
    for (let p = 1; p <= 3 && out.length < want; p++) {
      const url = 'https://www.pixiv.net/ajax/search/artworks/' + encodeURIComponent(query)
        + '?word=' + encodeURIComponent(query) + '&order=' + order + '&mode=all&p=' + p + '&s_mode=s_tag&type=all&lang=zh'
      let j
      try { j = await getJson(url, { proxy: true, timeout: 25000, headers: PIXIV_HEADERS }) }
      catch (e) { if (order === 'popular_d' && p === 1) throw e; break }
      const rows = (j && j.body && j.body.illustManga && j.body.illustManga.data) || []
      if (!rows.length) break
      for (const it of rows) {
        const id = String(it.id || '')
        if (!id || seen.has(id)) continue
        const aiType = num(it.aiType)
        if (noAI && aiType === 2) continue
        seen.add(id)
        const master = String(it.url || '').replace('/c/250x250_80_a2/', '/').replace('_square1200.', '_master1200.')
        if (!master) continue
        out.push({ engine: 'pixiv', thumb: '', full: master, page: 'https://www.pixiv.net/artworks/' + id,
          title: String(it.title || ''), width: num(it.width), height: num(it.height),
          referer: 'https://www.pixiv.net/', proxy: true, id, aiType })
      }
    }
    if (out.length >= Math.min(Math.max(want, 20), 60)) break
  }
  return out
}

/** Pixiv 原图：搜索接口只给缩略图路径，原图尺寸/扩展名要看作品详情 */
export async function pixivOriginal(id) {
  const j = await getJson('https://www.pixiv.net/ajax/illust/' + encodeURIComponent(id) + '?lang=zh',
    { proxy: true, timeout: 20000, headers: PIXIV_HEADERS })
  const b = (j && j.body) || {}
  return { url: b.urls && b.urls.original ? String(b.urls.original) : '',
    author: b.userName ? String(b.userName) : '', aiType: num(b.aiType) }
}

/** Wallhaven：SFW 二次元壁纸，原图分辨率高；接口免 key，一页 24 条 */
async function srcWallhaven(query, want) {
  const out = []
  for (let page = 1; page <= 4 && out.length < want; page++) {
    const url = 'https://wallhaven.cc/api/v1/search?q=' + encodeURIComponent(String(query || '').trim())
      + '&categories=010&purity=100&sorting=relevance&page=' + page
    const j = await getJson(url, { proxy: true, timeout: 25000 })
    const rows = (j && j.data) || []
    if (!rows.length) break
    for (const it of rows) {
      if (!it.path) continue
      const res = String(it.resolution || '').split('x')
      out.push({ engine: 'wallhaven', thumb: (it.thumbs && it.thumbs.large) || '', full: it.path,
        page: it.url || '', title: 'wallhaven-' + String(it.id || ''),
        width: num(res[0]), height: num(res[1]), referer: 'https://wallhaven.cc/', proxy: true })
    }
  }
  return out
}

/** Konachan（Moebooru）：壁纸向二次元插画，按评分排序质量稳；只认英文 tag，且宫崎骏相关总量少 */
async function srcKonachan(query, want) {
  const tags = booruTags(query)
  if (!tags) throw new Error('konachan 只认英文/罗马音 tag（如 ghibli、totoro、hatsune_miku），中文关键词请改写')
  const out = []
  for (let page = 1; page <= 3 && out.length < want; page++) {
    const j = await getJson('https://konachan.net/post.json?tags=' + encodeURIComponent(tags + ' rating:safe order:score')
      + '&limit=100&page=' + page, { proxy: true, timeout: 30000 })
    const rows = Array.isArray(j) ? j : []
    if (!rows.length) break
    for (const it of rows) {
      if (!it.file_url) continue
      out.push({ engine: 'konachan', thumb: it.preview_url || it.sample_url || '', full: it.file_url,
        page: 'https://konachan.net/post/show/' + it.id, title: String(it.tags || '').slice(0, 120),
        width: num(it.width), height: num(it.height), referer: 'https://konachan.net/', proxy: true })
    }
  }
  return out
}

/** Safebooru（Gelbooru 0.2 克隆）：全年龄、量最大但内容杂（合辑/拼贴偏多），按评分排序取 */
async function srcSafebooru(query, want) {
  const tags = booruTags(query)
  if (!tags) throw new Error('safebooru 只认英文/罗马音 tag（如 studio_ghibli、totoro），中文关键词请改写')
  const out = []
  for (let page = 0; page < 3 && out.length < want; page++) {
    const j = await getJson('https://safebooru.org/index.php?page=dapi&s=post&q=index&json=1&limit=100&pid=' + page
      + '&tags=' + encodeURIComponent(tags + ' sort:score:desc'), { proxy: true, timeout: 30000 })
    const rows = Array.isArray(j) ? j : []
    if (!rows.length) break
    for (const it of rows) {
      const full = it.file_url || it.sample_url
      if (!full) continue
      out.push({ engine: 'safebooru', thumb: it.preview_url || '', full,
        page: 'https://safebooru.org/index.php?page=post&s=view&id=' + it.id,
        title: String(it.tags || '').slice(0, 120), width: num(it.width), height: num(it.height),
        referer: 'https://safebooru.org/', proxy: true })
    }
  }
  return out
}

export const SOURCES = [
  { id: 'baidu', label: '百度图片', tag: '综合·中文语义强', kind: 'photo' },
  { id: 'bing', label: 'Bing 图片', tag: '综合·国际原图多', kind: 'photo' },
  { id: 'so360', label: '360 图片', tag: '综合·量大速度快', kind: 'photo' },
  { id: 'duitang', label: '堆糖', tag: '插画·头像·手账·手机壁纸', kind: 'photo' },
  { id: 'huaban', label: '花瓣', tag: '设计·家居·摄影·灵感图', kind: 'photo' },
  { id: 'duckduckgo', label: 'DuckDuckGo 图片', tag: '国外·聚合 Bing/Google 结果（走代理）', kind: 'photo', foreign: true },
  { id: 'yandex', label: 'Yandex 图片', tag: '国外·Pinterest 等原图多（走代理）', kind: 'photo', foreign: true },
  { id: 'openverse', label: 'Openverse', tag: 'CC 授权图库·免 key·偏可商用（走代理）', kind: 'photo', foreign: true },
  { id: 'wikimedia', label: 'Wikimedia Commons', tag: '公有领域/CC 素材（走代理）', kind: 'photo', foreign: true },
  { id: 'pixiv', label: 'Pixiv', tag: '二次元原创/同人·画师原图·免登录（走代理）', kind: 'photo', foreign: true },
  { id: 'wallhaven', label: 'Wallhaven', tag: '二次元壁纸·高分辨率原图（走代理）', kind: 'photo', foreign: true },
  { id: 'konachan', label: 'Konachan', tag: '二次元插画·评分排序（走代理）', kind: 'photo', foreign: true },
  { id: 'safebooru', label: 'Safebooru', tag: '二次元图库·量最大但杂（走代理）', kind: 'photo', foreign: true },
  { id: 'icons', label: 'Iconify 图标库', tag: 'SVG 图标/品牌 logo（可改色）', kind: 'icon' },
]
const PHOTO_IDS = SOURCES.filter((s) => s.kind === 'photo').map((s) => s.id)
const ALIAS = {
  auto: ['baidu', 'so360', 'bing'],
  all: PHOTO_IDS,
  both: ['baidu', 'bing'],
  intl: ['duckduckgo', 'yandex', 'bing'],
  cc: ['openverse', 'wikimedia'],
  anime: ['pixiv', 'wallhaven', 'konachan'],
  moe: ['pixiv', 'wallhaven', 'konachan', 'safebooru'],
  icons: ['icons'],
  default: ['baidu', 'so360', 'bing'],
}

export function resolveSources(spec) {
  const ids = new Set(SOURCES.map((s) => s.id))
  const one = (x) => {
    const k = String(x).trim().toLowerCase()
    if (ALIAS[k]) return ALIAS[k]
    const hit = [...ids].find((i) => i.toLowerCase() === k)
    if (!hit) throw new Error('未知图源 "' + x + '"。可用：' + PHOTO_IDS.join(' / ') + ' / icons / ' + Object.keys(ALIAS).filter((k) => k !== 'default' && k !== 'icons').join(' / '))
    return [hit]
  }
  if (spec === undefined || spec === null || spec === '') return ALIAS.auto.slice()
  if (Array.isArray(spec)) return [...new Set(spec.flatMap(one))]
  return [...new Set(one(spec))]
}

const foreignOf = (id) => { const s = SOURCES.find((x) => x.id === id); return !!(s && s.foreign) }

async function runSource(id, query, want, opts) {
  if (id === 'baidu') return srcBaidu(query, want)
  if (id === 'bing') return srcBing(query, want, opts)
  if (id === 'so360') return src360(query, want)
  if (id === 'duitang') return srcDuitang(query, want)
  if (id === 'huaban') return srcHuaban(query, want)
  if (id === 'duckduckgo') return srcDuckDuckGo(query, want)
  if (id === 'yandex') return srcYandex(query, want)
  if (id === 'openverse') return srcOpenverse(query, want)
  if (id === 'wikimedia') return srcWikimedia(query, want)
  if (id === 'pixiv') return srcPixiv(query, want, opts)
  if (id === 'wallhaven') return srcWallhaven(query, want)
  if (id === 'konachan') return srcKonachan(query, want)
  if (id === 'safebooru') return srcSafebooru(query, want)
  if (id === 'icons') return srcIcons(query, want, opts)
  throw new Error('未实现的图源 ' + id)
}

/** 各源并行搜 + 按源轮转交错（保证前几张是混合来源，而不是被第一个源占满） */
export async function searchAll(query, opts = {}) {
  const { limit = 40, minPixels = 0, collection, color, sources } = opts
  const ids = resolveSources(sources !== undefined ? sources : opts.engine)
  const settled = await Promise.allSettled(ids.map((id) => runSource(id, query, Math.max(limit, 40), { collection, color, noAI: opts.noAI === true, proxy: foreignOf(id) })))
  const errors = []
  const buckets = settled.map((r, i) => {
    if (r.status === 'rejected') { errors.push({ stage: 'search:' + ids[i], error: String(r.reason && r.reason.message || r.reason) }); return [] }
    return r.value
  })
  const seen = new Set()
  const merged = []
  const maxLen = Math.max(0, ...buckets.map((b) => b.length))
  for (let i = 0; i < maxLen; i++) {
    for (const b of buckets) {
      const c = b[i]
      if (!c) continue
      const k = String(c.full || '').split('?')[0].replace(/^https?:\/\//, '')
      if (!k || seen.has(k)) continue
      seen.add(k)
      merged.push(c)
    }
  }
  const filtered = minPixels ? merged.filter((c) => !(c.width && c.height && Math.max(c.width, c.height) < minPixels)) : merged
  return { results: filtered.slice(0, limit), total: filtered.length, errors, sources: ids }
}

// ───────────────────────── 下载 ─────────────────────────

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif', 'image/svg+xml': '.svg' }
const MEDIA = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' }

/** 按文件头判真实格式：safebooru 的 file_url 后缀常骗人（.jpg 实际是 png），content-type 也不总对 */
function sniffExt(b) {
  if (!b || b.length < 12) return ''
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return '.jpg'
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return '.png'
  if (b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WEBP') return '.webp'
  if (b.slice(0, 3).toString('ascii') === 'GIF') return '.gif'
  if (b.slice(4, 12).toString('ascii').startsWith('ftypavif')) return '.avif'
  return ''
}

function extFrom(ct, url) {
  if (EXT[ct]) return EXT[ct]
  const m = /\.(jpe?g|png|webp|gif|avif|svg)(?:\?|$)/i.exec(url || '')
  return m ? '.' + m[1].toLowerCase().replace('jpeg', 'jpg') : '.jpg'
}

export async function fetchImage(url, referer, useProxy = false) {
  const r = useProxy
    ? await request(url, { proxy: true, timeout: 45000, headers: { ...(referer ? { Referer: referer } : {}) } })
    : await fetch(url, { headers: { 'User-Agent': UA, ...(referer ? { Referer: referer } : {}) },
      redirect: 'follow', signal: AbortSignal.timeout(30000) })
  if (!r.ok) throw new Error('HTTP ' + r.status)
  const ct = ((r.headers.get('content-type') || '').split(';')[0] || '').trim().toLowerCase()
  if (ct && !ct.startsWith('image/')) throw new Error('不是图片: ' + ct)
  const len = Number(r.headers.get('content-length') || 0)
  if (len && len > MAX_BYTES) throw new Error('文件过大: ' + Math.round(len / 1048576) + 'MB')
  const data = Buffer.from(await r.arrayBuffer())
  if (data.length < 128) throw new Error('太小: ' + data.length + 'B')
  if (data.length > MAX_BYTES) throw new Error('文件过大: ' + Math.round(data.length / 1048576) + 'MB')
  const ext = sniffExt(data) || extFrom(ct, url)
  return { data, ext, mediaType: MEDIA[ext] || ct || 'image/jpeg' }
}

/**
 * 搜图并下载（不依赖 DSH ctx）。
 * opts: { count, engine, sources, outRoot, minPixels, collection, color, onImage(relPath, data, mediaType, ext) }
 */
export async function huntStandalone(query, opts = {}) {
  const { count = 8, outRoot, minPixels = 0, onImage, relBase } = opts
  const toRel = (p) => path.relative(relBase || outRoot, p).split(path.sep).join('/')
  const destDir = path.join(outRoot, slugify(query))
  const { results: cands, total, errors, sources } = await searchAll(query, { limit: Math.max(count * 5, 60), minPixels, engine: opts.engine, sources: opts.sources, collection: opts.collection, color: opts.color, noAI: opts.noAI === true })
  mkdirSync(destDir, { recursive: true })
  const files = [], skipped = [], images = []
  for (const c of cands) {
    if (files.length >= count) break
    const stem = path.join(destDir, String(files.length + 1).padStart(2, '0'))
    try {
      // pixiv：搜索接口只给 master1200，下载时换成原图并顺带记下画师（取不到就退回 master1200）
      let full = c.full
      let credit = c.license
      if (c.engine === 'pixiv' && c.id) {
        try {
          const o = await pixivOriginal(c.id)
          if (o.url) full = o.url
          if (o.author) credit = 'Pixiv · @' + o.author
        } catch (e) { /* 详情拿不到不影响下载 */ }
        if (c.aiType === 2) credit = (credit ? credit + ' · ' : '') + 'AI 生成'
      }
      const got = await fetchImage(full, c.referer, c.proxy)
      const file = stem + got.ext
      writeFileSync(file, got.data)
      const rec = { path: toRel(file), bytes: got.data.length, source: c.engine, site: siteOf(c.engine),
        page: c.page, title: c.title, ...dimFields(got.data, c.width, c.height), url: full, ...(credit ? { license: credit } : {}) }
      files.push(rec)
      if (onImage && got.ext !== '.svg') await onImage(rec.path, got.data, got.mediaType, got.ext)
      if (got.ext === '.svg') skipped.push({ note: 'SVG 不登记为图片附件（会话内不渲染），文件已落盘', file: rec.path })
    } catch (err) {
      skipped.push({ url: c.full, error: String(err && err.message || err) })
      if (c.thumb && c.thumb !== c.full && skipped.length <= 3) {
        try {
          const got = await fetchImage(c.thumb, c.referer, c.proxy)
          const file = stem + got.ext
          writeFileSync(file, got.data)
          const rec = { path: toRel(file), bytes: got.data.length, source: c.engine + ':thumb', site: siteOf(c.engine),
            page: c.page, title: c.title, ...dimFields(got.data, c.width, c.height), url: c.thumb }
          files.push(rec)
          if (onImage && got.ext !== '.svg') await onImage(rec.path, got.data, got.mediaType, got.ext)
        } catch (e2) { skipped.push({ url: c.thumb, error: String(e2 && e2.message || e2) }) }
      }
    }
  }
  writeFileSync(path.join(destDir, 'meta.json'), JSON.stringify({ query, sources, count: files.length, fetchedAt: new Date().toISOString(), files, skipped: skipped.slice(0, 60) }, null, 2), 'utf8')
  return { query, dir: destDir, downloaded: files.length, candidates: total, skipped: skipped.length, files, errors, images }
}

/** 已知直链批量落盘（不依赖 DSH ctx） */
export async function downloadUrlsStandalone(urls, outDir, opts = {}) {
  const { prefix = 'img-', referer, onImage, relBase, proxy = false } = opts
  const toRel = (p) => path.relative(relBase || outDir, p).split(path.sep).join('/')
  mkdirSync(outDir, { recursive: true })
  const files = [], errors = []
  let i = 0
  for (const u of urls) {
    i += 1
    try {
      const got = await fetchImage(u, referer, proxy)
      const file = path.join(outDir, prefix + String(i).padStart(2, '0') + got.ext)
      writeFileSync(file, got.data)
      const rec = { path: toRel(file), bytes: got.data.length, url: u }
      files.push(rec)
      if (onImage && got.ext !== '.svg') await onImage(rec.path, got.data, got.mediaType, got.ext)
    } catch (err) { errors.push({ url: u, error: String(err && err.message || err) }) }
  }
  return { dir: outDir, downloaded: files.length, files, errors }
}

// ───────────────────────── 工具注册 ─────────────────────────

const SOURCE_CHEAT = SOURCES.map((s) => s.id + '=' + s.label + '（' + s.tag + '）').join('；')
const SKILL = [
  '# image-hunt · 多图源搜图 + 下载进工作区',
  '',
  '当用户说「找几张图 / 配图 / 搜图 / 下载图片 / 给我 XX 的素材」时用它。',
  '',
  '- image_hunt：关键词 → 多图源搜 → 下载到会话工作区 images/<关键词>/ → 直接把图显示在对话里。',
  '- image_search：只搜不下载，给候选列表（URL/来源/尺寸），先挑后下。',
  '- image_download：已知图片直链时直接落盘。',
  '',
  '图源（engine 参数可选单个 id，或 auto/all/both/intl/cc/anime/moe/icons；也可用 sources 传数组混合）：',
  SOURCE_CHEAT,
  '',
  '国外图源会自动走本机代理（默认 http://127.0.0.1:7890）：duckduckgo / yandex / openverse / wikimedia / pixiv / wallhaven / konachan / safebooru，以及 bing 的 www.bing.com 国际站。',
  '- 代理地址可用环境变量 IMAGE_HUNT_PROXY 或 HTTPS_PROXY 覆盖，设成 off 关闭；代理不通会自动退回直连，国内源不受影响。',
  '- 抓不动 Google 图片网页版（JS 门控）和 X/Instagram（要登录态）——这三家请用 BrowserSkill 走真实浏览器。',
  '',
  '用法惯例：',
  '1. 默认 engine=auto（百度+360+Bing 中文综合）；要国外图用 engine=intl（DuckDuckGo+Yandex+Bing 国际）或 sources:["duckduckgo","yandex"]；要 CC 授权/可商用素材用 engine=cc（Openverse+Wikimedia）。',
  '1b. 要设计灵感加 duitang/huaban；要矢量图标用 engine=icons。',
  '1c. 二次元 / 宫崎骏画风：engine=anime（Pixiv 原创同人 + Wallhaven 高分壁纸 + Konachan 插画）；要更大量再加 sources:["safebooru"]（量大但杂，多为合辑/拼贴）。',
  '1d. booru 系（konachan / safebooru）只认英文 tag，中文词走内置映射（宫崎骏/吉卜力→ghibli、龙猫→totoro、千与千寻→spirited_away、魔女宅急便→kiki…）；没映射的中文词会被丢掉并报错，这时改写成英文/罗马音。Pixiv 中文日文都能搜。',
  '1e. Pixiv 的 AI 图占三到五成：要纯手绘图给 noAI:true（只对 pixiv 生效）；meta.json 的 license 字段里会写画师（Pixiv · @作者）与是否 AI。',
  '2. 图标/logo：engine=icons 配 collection（如 simple-icons 品牌 logo、mdi、tabler、logos），需要白色/黑色图标给 color。',
  '3. minPixels 过滤小图（做 PPT/背景图建议 >=1200）；icons 源没有像素尺寸，不受该过滤影响。',
  '4. 图落到工作区后就是普通文件：可 read_image、写进 HTML、present 给用户；SVG 只落盘不入附件。',
  '5. 每个目录都有 meta.json（原图直链 + 来源页 + 标题 + 尺寸 + license），需要溯源/署名时读它。',
  '6. 版权：用户自用不商用；对外发布前提示用户确认授权。别高频猛刷（会被限流）。',
].join('\n')

/** 结果目录收口：只允许会话工作区内 */
function safeJoin(root, rel) {
  const base = path.resolve(root)
  const abs = path.resolve(base, rel)
  if (abs !== base && !abs.startsWith(base + path.sep)) throw new Error('输出目录必须位于当前会话工作区内：' + base)
  return abs
}

export function apply(ctx, config = {}) {
  if (config.proxy !== undefined) setProxy(config.proxy === 'off' || config.proxy === false ? null : config.proxy)
  const DEFAULT_DIR = config.defaultDir || 'images'
  try {
    ctx.skills.register({
      name: 'image-hunt',
      description: '多图源搜网图并下载进工作区（百度/Bing/360/堆糖/花瓣/DuckDuckGo/Yandex/Openverse/Wikimedia/Iconify 图标，国外源走本机代理）；用户要"找图/配图/下载图片/图标/素材"时使用 (image_hunt / image_search / image_download)。',
      content: SKILL,
      source: 'bundled',
    })
  } catch (e) {
    ctx.logger?.warn?.('image-hunt: skill 注册失败 (%s)，工具仍可用', e?.message || e)
  }

  const workspaceOf = (exec) => exec?.agent?.session?.header?.cwd || process.cwd()
  const SCHEMA = { type: 'object', additionalProperties: true }
  const renderWithImages = (_args, value) => [
    { type: 'text', text: JSON.stringify({ ...value, images: undefined }, null, 2) },
    ...(value.images || []).map((attachment) => ({ type: 'image', attachment })),
  ]

  /** 图片落盘后的附件登记（失败只 warn，文件已落盘） */
  const attachFactory = (cwd, images) => async (relPath, data, mediaType, ext) => {
    try {
      images.push(await ctx.attachments.saveImage({ data, mediaType, name: 'img-' + String(images.length + 1).padStart(2, '0') + ext }))
    } catch (e) {
      ctx.logger?.warn?.('image-hunt: 附件登记失败 %s (%s)', relPath, e?.message || e)
    }
  }

  const SOURCE_PARAMS = {
    engine: { type: 'string', description: '图源：auto(默认,百度+360+Bing) / intl(国外,DuckDuckGo+Yandex+Bing 国际,走代理) / cc(可商用,Openverse+Wikimedia) / anime(二次元,Pixiv+Wallhaven+Konachan) / moe(二次元+量,含 Safebooru) / all(全部) / both(百度+Bing) / icons(图标) / ' + SOURCES.map((s) => s.id).join(' / ') },
    sources: { type: 'array', items: { type: 'string' }, description: '要混用的图源 id 数组，给了它就以它为准（例 ["duitang","huaban"]）' },
    minPixels: { type: 'integer', minimum: 0, description: '长边像素下限，0=不过滤（icons 源无像素尺寸）' },
    noAI: { type: 'boolean', description: '只保留非 AI 生成图（仅 pixiv 源生效；二次元找纯手绘时用）' },
  }

  ctx.tools.register({
    name: 'image_hunt',
    description: '多图源按关键词搜图并把图片下载进当前会话工作区，结果直接在对话里显示。用户想要"找几张图/配图/素材/背景图/下载图片/图标"时首选这个。图源：' + SOURCE_CHEAT + '。国外源（duckduckgo/yandex/openverse/wikimedia/pixiv/wallhaven/konachan/safebooru 与 bing 国际站）自动走本机代理，代理不通退回直连。文件落在 dir（默认 images/<关键词>/），同目录写 meta.json（原图直链、来源页、标题、尺寸、license）。',
    timeoutMs: 300000,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词，中文效果最好，可带"高清/壁纸/插画/透明背景"等修饰' },
        count: { type: 'integer', minimum: 1, maximum: 40, description: '目标下载张数，默认 8' },
        ...SOURCE_PARAMS,
        dir: { type: 'string', description: '工作区内的输出目录，默认 images；必须是相对路径且不越出工作区' },
        collection: { type: 'string', description: 'engine=icons 时限定图标集：simple-icons(品牌 logo) / mdi / tabler / logos / ph …' },
        color: { type: 'string', description: 'engine=icons 时给 SVG 上色，如 #ffffff' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    async execute(args, exec) {
      const cwd = workspaceOf(exec)
      const outRoot = safeJoin(cwd, args.dir || DEFAULT_DIR)
      const images = []
      const r = await huntStandalone(args.query, {
        count: args.count || 8, engine: args.engine, sources: args.sources, minPixels: args.minPixels,
        collection: args.collection, color: args.color, noAI: args.noAI === true, outRoot, relBase: cwd, onImage: attachFactory(cwd, images),
      })
      return { query: r.query, dir: path.relative(cwd, r.dir).split(path.sep).join('/'), downloaded: r.downloaded,
        candidates: r.candidates, skipped: r.skipped, files: r.files, errors: r.errors, images }
    },
    output: { schema: SCHEMA, render: renderWithImages },
  })

  ctx.tools.register({
    name: 'image_search',
    description: '只搜图不下载：返回候选图片列表（原图直链、来源页、标题、尺寸、图源）。先让用户挑图、再决定下载哪些时用；随后用 image_download 落盘。',
    timeoutMs: 120000,
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: '搜索关键词' }, ...SOURCE_PARAMS },
      required: ['query'],
      additionalProperties: false,
    },
    async execute(args) {
      const r = await searchAll(args.query, { limit: 20, engine: args.engine, sources: args.sources, minPixels: args.minPixels, collection: args.collection, color: args.color, noAI: args.noAI === true })
      return { query: args.query, sources: r.sources, total: r.total, results: r.results, errors: r.errors }
    },
    output: { schema: SCHEMA, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
  })

  ctx.tools.register({
    name: 'image_download',
    description: '把已知的图片直链下载进当前会话工作区（例如 image_search 挑出来的 url，或你在网页上看到的图）。落盘后图片会直接显示在对话里（SVG 只落盘）。国外图床（Google/Pinterest/X 等）需要 proxy=true。',
    timeoutMs: 300000,
    parameters: {
      type: 'object',
      properties: {
        urls: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 30, description: '图片直链数组' },
        dir: { type: 'string', description: '工作区内的输出目录，默认 images/downloads' },
        prefix: { type: 'string', description: '文件名前缀，默认 img-' },
        referer: { type: 'string', description: '部分站点需要 Referer 才放行图片' },
        proxy: { type: 'boolean', description: '经本机代理下载（国外图床需要），默认 false' },
      },
      required: ['urls'],
      additionalProperties: false,
    },
    async execute(args, exec) {
      const cwd = workspaceOf(exec)
      const destDir = safeJoin(cwd, args.dir || path.join(DEFAULT_DIR, 'downloads'))
      const images = []
      const r = await downloadUrlsStandalone(args.urls, destDir, { prefix: args.prefix || 'img-', referer: args.referer, proxy: args.proxy === true, relBase: cwd, onImage: attachFactory(cwd, images) })
      return { dir: path.relative(cwd, destDir).split(path.sep).join('/'), downloaded: r.downloaded, files: r.files, errors: r.errors, images }
    },
    output: { schema: SCHEMA, render: renderWithImages },
  })
}
