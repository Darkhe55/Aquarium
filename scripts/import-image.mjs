/**
 * 水箱（Aquarium）题面图片自动导入
 *
 * 用法：
 *   node scripts/import-image.mjs <图片路径> [--name 名称] [--append] [--verify]
 *                                   [--width 30 --height 30] [--thick 3]
 *                                   [--map 0=1,1=3]  （人工覆盖字形簇 → 数字）
 *                                   [--dry]
 *
 * 流程：
 *   1. Playwright + Edge 把图片画到 canvas 取像素；
 *   2. 投影暗像素找网格外框与格子间距，得到 W×H；
 *   3. 每个格边中点测暗线厚度，1D k-means 分出细网格线与粗水箱壁，四连通洪泛得到水箱编号；
 *   4. 盘外行列数字按字形簇识别（内置多套字体模板自动择优），--map 可人工覆盖；
 *   5. 预览水箱矩阵/行列和；--append 追加到 src/game/puzzles-data.ts；
 *   6. --verify 用项目求解器检查唯一解（超时只警告，不写参考解）。
 */

import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright-core'

const EDGE_PATH =
  process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const NORM = 20 // 字形归一化网格
const CLUSTER_SIM = 0.86

const argv = process.argv.slice(2)
const has = (flag) => argv.includes(flag)
const arg = (flag, fallback = null) => {
  const i = argv.findIndex((a) => a === flag || a.startsWith(flag + '='))
  if (i < 0) return fallback
  return argv[i].startsWith(flag + '=') ? argv[i].slice(flag.length + 1) : (argv[i + 1] ?? fallback)
}
const imagePath = argv.find((a) => !a.startsWith('--'))
if (!imagePath) {
  console.error(
    '用法：node scripts/import-image.mjs <图片路径> [--name 名称] [--append] [--verify] [--width N --height N] [--thick N] [--map 0=1,1=3] [--dry]',
  )
  process.exit(1)
}
if (!fs.existsSync(imagePath)) {
  console.error('找不到图片：', imagePath)
  process.exit(1)
}

const widthOpt = Number(arg('--width', '0')) || 0
const heightOpt = Number(arg('--height', '0')) || 0
const thickOpt = Number(arg('--thick', '0')) || 0
const name = arg('--name', path.basename(imagePath, path.extname(imagePath)))
const series = arg('--series', '导入')
const append = has('--append')
const verify = has('--verify')
const dry = has('--dry')
const debugDir = arg('--debug', '')
const maxNodesOpt = Number(arg('--max-nodes', '150000')) || 150000

const manualMapArg = arg('--map', '')
const manualMap = {}
if (manualMapArg) {
  for (const pair of String(manualMapArg).split(',')) {
    const [k, v] = pair.split('=')
    if (k !== undefined && v !== undefined && k.trim() !== '' && v.trim() !== '') {
      manualMap[Number(k)] = Number(v)
    }
  }
}

/* ═══════════════════════════ 像素分析（浏览器内） ═══════════════════════════ */

const dataUrl = 'data:image/png;base64,' + fs.readFileSync(imagePath).toString('base64')
const browser = await chromium.launch({ headless: true, executablePath: EDGE_PATH })
const page = await browser.newPage()

const analyzed = await page.evaluate(
  async ({ u, widthOpt, heightOpt, thickOpt, NORM, debug }) => {
    const img = new Image()
    img.src = u
    await img.decode()
    const W = img.naturalWidth
    const H = img.naturalHeight
    const cv = document.createElement('canvas')
    cv.width = W
    cv.height = H
    const g = cv.getContext('2d', { willReadFrequently: true })
    g.drawImage(img, 0, 0)
    const px = g.getImageData(0, 0, W, H).data
    const dark = (x, y) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return false
      const i = (y * W + x) * 4
      return 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2] < 120
    }

    // 1) 投影找贯穿棋盘的长线
    const colC = new Int32Array(W)
    const rowC = new Int32Array(H)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (dark(x, y)) {
          colC[x]++
          rowC[y]++
        }
    const clusters = (counts, thr) => {
      const out = []
      let s = -1
      for (let i = 0; i < counts.length; i++) {
        const on = counts[i] >= thr
        if (on && s < 0) s = i
        if (!on && s >= 0) {
          out.push((s + i - 1) / 2)
          s = -1
        }
      }
      if (s >= 0) out.push((s + counts.length - 1) / 2)
      return out
    }
    let xs = clusters(colC, H * 0.7)
    let ys = clusters(rowC, W * 0.7)
    const autoW = xs.length - 1
    const autoH = ys.length - 1
    const w = widthOpt || autoW
    const h = heightOpt || autoH
    if (!(w >= 2) || !(h >= 2) || xs.length < 2 || ys.length < 2) {
      throw new Error(`无法确定网格：识别到 ${xs.length} 条竖线 / ${ys.length} 条横线`)
    }
    if (xs.length !== w + 1 || ys.length !== h + 1) {
      throw new Error(`网格不匹配：识别到 ${xs.length - 1}×${ys.length - 1}，目标 ${w}×${h}`)
    }
    const x0 = xs[0]
    const x1 = xs[w]
    const y0 = ys[0]
    const y1 = ys[h]
    const cellX = (x1 - x0) / w
    const cellY = (y1 - y0) / h
    const pxPerCell = (cellX + cellY) / 2

    // 2) 暗线厚度
    const runX = (cx, cy, radius) => {
      let best = 0
      let run = 0
      for (let x = Math.round(cx - radius); x <= Math.round(cx + radius); x++) {
        if (dark(x, Math.round(cy))) {
          run++
          if (run > best) best = run
        } else run = 0
      }
      return best
    }
    const runY = (cx, cy, radius) => {
      let best = 0
      let run = 0
      for (let y = Math.round(cy - radius); y <= Math.round(cy + radius); y++) {
        if (dark(Math.round(cx), y)) {
          run++
          if (run > best) best = run
        } else run = 0
      }
      return best
    }
    const vThick = [] // [i,j,thickness] 竖边：第 i 列格与第 i-1 列格之间
    const hThick = []
    for (let i = 1; i < w; i++) {
      for (let j = 0; j < h; j++) {
        const cx = x0 + i * cellX
        const cy = y0 + (j + 0.5) * cellY
        const t = Math.max(
          runX(cx, cy - cellY * 0.22, cellX * 0.28),
          runX(cx, cy, cellX * 0.28),
          runX(cx, cy + cellY * 0.22, cellX * 0.28),
        )
        vThick.push([i, j, t])
      }
    }
    for (let j = 1; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const cx = x0 + (i + 0.5) * cellX
        const cy = y0 + j * cellY
        const t = Math.max(
          runY(cx - cellX * 0.22, cy, cellY * 0.28),
          runY(cx, cy, cellY * 0.28),
          runY(cx + cellX * 0.22, cy, cellY * 0.28),
        )
        hThick.push([i, j, t])
      }
    }
    const all = [...vThick.map((r) => r[2]), ...hThick.map((r) => r[2])]
    const sorted = all.slice().sort((a, b) => a - b)
    let c1 = sorted[0]
    let c2 = sorted[sorted.length - 1]
    for (let it = 0; it < 40; it++) {
      let s1 = 0
      let n1 = 0
      let s2 = 0
      let n2 = 0
      for (const v of all) {
        if (Math.abs(v - c1) <= Math.abs(v - c2)) {
          s1 += v
          n1++
        } else {
          s2 += v
          n2++
        }
      }
      if (n1) c1 = s1 / n1
      if (n2) c2 = s2 / n2
    }
    const thick =
      thickOpt > 0 ? thickOpt : Math.max(1.5, (c1 + c2) / 2 + (c2 - c1) * 0.05, pxPerCell * 0.05)
    const isThick = (v) => v >= thick

    // 3) 洪泛得到水箱编号
    const tanks = new Array(w * h).fill(-1)
    let tankCount = 0
    const vWall = Array.from({ length: w }, () => new Uint8Array(h))
    const hWall = Array.from({ length: h }, () => new Uint8Array(w))
    for (const [i, j, t] of vThick) if (isThick(t)) vWall[i][j] = 1
    for (const [i, j, t] of hThick) if (isThick(t)) hWall[j][i] = 1
    const cellOf = (i, j) => j * w + i
    for (let start = 0; start < w * h; start++) {
      if (tanks[start] !== -1) continue
      const id = tankCount++
      tanks[start] = id
      const stack = [start]
      while (stack.length) {
        const c = stack.pop()
        const x = c % w
        const y = (c / w) | 0
        const push = (nc) => {
          if (tanks[nc] === -1) {
            tanks[nc] = id
            stack.push(nc)
          }
        }
        if (x > 0 && !vWall[x][y]) push(cellOf(x - 1, y))
        if (x + 1 < w && !vWall[x + 1][y]) push(cellOf(x + 1, y))
        if (y > 0 && !hWall[y][x]) push(cellOf(x, y - 1))
        if (y + 1 < h && !hWall[y + 1][x]) push(cellOf(x, y + 1))
      }
    }
    const sizes = new Array(tankCount).fill(0)
    for (const t of tanks) sizes[t]++

    // 调试：把识别到的粗壁画成红色覆盖层
    let overlay = null
    if (debug) {
      const oc = document.createElement('canvas')
      oc.width = W
      oc.height = H
      const og = oc.getContext('2d')
      og.drawImage(img, 0, 0)
      og.fillStyle = 'rgba(220,30,30,0.85)'
      for (let i = 1; i < w; i++)
        for (let j = 0; j < h; j++)
          if (vWall[i][j]) og.fillRect(x0 + i * cellX - 1.5, y0 + j * cellY, 3, cellY)
      for (let j = 1; j < h; j++)
        for (let i = 0; i < w; i++)
          if (hWall[j][i]) og.fillRect(x0 + i * cellX, y0 + j * cellY - 1.5, cellX, 3)
      overlay = oc.toDataURL('image/png').slice('data:image/png;base64,'.length)
    }

    // 4) 字形提取（连通域 + 20×20 归一化）
    const normalize = (mask, bw, bh) => {
      const out = new Array(NORM * NORM).fill(0)
      for (let j = 0; j < NORM; j++)
        for (let i = 0; i < NORM; i++) {
          const ax0 = Math.floor((i * bw) / NORM)
          const ax1 = Math.max(ax0 + 1, Math.floor(((i + 1) * bw) / NORM))
          const ay0 = Math.floor((j * bh) / NORM)
          const ay1 = Math.max(ay0 + 1, Math.floor(((j + 1) * bh) / NORM))
          let s = 0
          let n = 0
          for (let y = ay0; y < ay1; y++)
            for (let x = ax0; x < ax1; x++) {
              s += mask[y * bw + x]
              n++
            }
          out[j * NORM + i] = s / n >= 0.5 ? 1 : 0
        }
      return out
    }
    const extract = (rx0, ry0, rx1, ry1, group, order) => {
      const xa = Math.max(0, Math.round(rx0))
      const ya = Math.max(0, Math.round(ry0))
      const ww = Math.min(W - xa, Math.round(rx1 - xa))
      const hh = Math.min(H - ya, Math.round(ry1 - ya))
      if (ww <= 0 || hh <= 0) return []
      const mask = new Uint8Array(ww * hh)
      for (let y = 0; y < hh; y++)
        for (let x = 0; x < ww; x++) mask[y * ww + x] = dark(xa + x, ya + y) ? 1 : 0
      const seen = new Uint8Array(ww * hh)
      const out = []
      for (let i = 0; i < ww * hh; i++) {
        if (!mask[i] || seen[i]) continue
        const stack = [i]
        seen[i] = 1
        let bx0 = ww
        let bx1 = -1
        let by0 = hh
        let by1 = -1
        let area = 0
        while (stack.length) {
          const p = stack.pop()
          area++
          const x = p % ww
          const y = (p / ww) | 0
          if (x < bx0) bx0 = x
          if (x > bx1) bx1 = x
          if (y < by0) by0 = y
          if (y > by1) by1 = y
          for (const [dx, dy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ]) {
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || ny < 0 || nx >= ww || ny >= hh) continue
            const np = ny * ww + nx
            if (mask[np] && !seen[np]) {
              seen[np] = 1
              stack.push(np)
            }
          }
        }
        const bw = bx1 - bx0 + 1
        const bh = by1 - by0 + 1
        if (area < Math.max(8, (ww * hh) / 900) || bh < hh * 0.2) continue
        const sub = new Uint8Array(bw * bh)
        for (let y = 0; y < bh; y++)
          for (let x = 0; x < bw; x++) sub[y * bw + x] = mask[(by0 + y) * ww + bx0 + x]
        out.push({
          group,
          order,
          x: xa + bx0,
          y: ya + by0,
          w: bw,
          h: bh,
          area,
          m: normalize(sub, bw, bh),
        })
      }
      return out
    }

    const glyphs = []
    // 行和：盘外左侧，右对齐，每行一个数
    for (let j = 0; j < h; j++) {
      const cy = y0 + (j + 0.5) * cellY
      glyphs.push(
        ...extract(x0 - 1.18 * cellX, cy - 0.42 * cellY, x0 - 0.08 * cellX, cy + 0.42 * cellY, `r${j}`, j),
      )
    }
    // 列和：盘外上方，每列一个数
    for (let i = 0; i < w; i++) {
      const cx = x0 + (i + 0.5) * cellX
      glyphs.push(
        ...extract(cx - 0.5 * cellX, y0 - 0.92 * cellY, cx + 0.5 * cellX, y0 - 0.04 * cellY, `c${i}`, i),
      )
    }

    return {
      W,
      H,
      w,
      h,
      x0,
      y0,
      cellX,
      cellY,
      thick: Number(thick.toFixed(2)),
      lineThin: Number(c1.toFixed(2)),
      lineThick: Number(c2.toFixed(2)),
      tanks,
      tankCount,
      tankSizes: sizes,
      glyphs,
      overlay,
    }
  },
  { u: dataUrl, widthOpt, heightOpt, thickOpt, NORM, debug: !!debugDir },
)
if (analyzed.overlay) {
  const dir = debugDir || '.'
  fs.mkdirSync(dir, { recursive: true })
  const out = path.join(dir, path.basename(imagePath, path.extname(imagePath)) + '-walls.png')
  fs.writeFileSync(out, Buffer.from(analyzed.overlay, 'base64'))
  console.log(`[import] 调试覆盖图已写入 ${out}`)
}

/* ═══════════════════════════ 字形模板 + 分类 ═══════════════════════════ */
const medH = (() => {
  const hs = analyzed.glyphs.map((gl) => gl.h).sort((a, b) => a - b)
  return hs.length ? hs[Math.floor(hs.length / 2)] : 20
})()

const FONTS = []
for (const fam of ['Tahoma', 'Verdana', 'Arial', 'Segoe UI', 'Calibri'])
  for (const weight of [700, 400]) FONTS.push({ fam, weight })
const SIZES = [...new Set([0.66, 0.7, 0.74].map((r) => Math.max(8, Math.round(medH / r))))]

const templates = await page.evaluate(
  ({ FONTS, SIZES, NORM }) => {
    const render = (fam, weight, size, ch) => {
      const c = document.createElement('canvas')
      c.width = 160
      c.height = 160
      const g = c.getContext('2d', { willReadFrequently: true })
      g.fillStyle = '#fff'
      g.fillRect(0, 0, 160, 160)
      g.fillStyle = '#000'
      g.font = `${weight} ${size}px "${fam}"`
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText(ch, 80, 80)
      const d = g.getImageData(0, 0, 160, 160).data
      const dark = (x, y) => {
        const i = (y * 160 + x) * 4
        return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] < 120
      }
      let x0 = 160
      let x1 = -1
      let y0 = 160
      let y1 = -1
      for (let y = 0; y < 160; y++)
        for (let x = 0; x < 160; x++)
          if (dark(x, y)) {
            if (x < x0) x0 = x
            if (x > x1) x1 = x
            if (y < y0) y0 = y
            if (y > y1) y1 = y
          }
      if (x1 < 0) return null
      const bw = x1 - x0 + 1
      const bh = y1 - y0 + 1
      const out = new Array(NORM * NORM).fill(0)
      for (let j = 0; j < NORM; j++)
        for (let i = 0; i < NORM; i++) {
          const ax0 = Math.floor((i * bw) / NORM)
          const ax1 = Math.max(ax0 + 1, Math.floor(((i + 1) * bw) / NORM))
          const ay0 = Math.floor((j * bh) / NORM)
          const ay1 = Math.max(ay0 + 1, Math.floor(((j + 1) * bh) / NORM))
          let s = 0
          let n = 0
          for (let y = ay0; y < ay1; y++)
            for (let x = ax0; x < ax1; x++) {
              s += dark(x0 + x, y0 + y) ? 1 : 0
              n++
            }
          out[j * NORM + i] = s / n >= 0.5 ? 1 : 0
        }
      return out
    }
    const out = []
    for (const f of FONTS)
      for (const size of SIZES) {
        const digits = []
        for (const ch of '0123456789') digits.push(render(f.fam, f.weight, size, ch))
        out.push({ fam: f.fam, weight: f.weight, size, digits })
      }
    return out
  },
  { FONTS, SIZES, NORM },
)
await browser.close()

const sim = (a, b) => {
  let inter = 0
  let uni = 0
  for (let i = 0; i < a.length; i++) {
    if (a[i] && b[i]) inter++
    if (a[i] || b[i]) uni++
  }
  return uni ? inter / uni : 0
}
const bestDigit = (mask, tpl) => {
  let best = -1
  let bestScore = -1
  let second = -1
  for (let d = 0; d < 10; d++) {
    const s = sim(mask, tpl.digits[d])
    if (s > bestScore) {
      second = bestScore
      bestScore = s
      best = d
    } else if (s > second) second = s
  }
  return { digit: best, score: bestScore, margin: bestScore - second }
}

// 选整体最匹配的字体/字号
let chosen = null
for (const cand of templates) {
  let total = 0
  for (const gl of analyzed.glyphs) total += bestDigit(gl.m, cand).score
  const avg = analyzed.glyphs.length ? total / analyzed.glyphs.length : 0
  if (!chosen || avg > chosen.avg) chosen = { ...cand, avg }
}
if (!chosen) {
  console.error('[import] 没有可用字体模板')
  process.exit(1)
}

// 字形聚类 + 每簇分类
const clusterOf = []
const clusters = []
for (let gi = 0; gi < analyzed.glyphs.length; gi++) {
  const gl = analyzed.glyphs[gi]
  let best = -1
  let bestScore = CLUSTER_SIM
  for (let k = 0; k < clusters.length; k++) {
    const s = sim(gl.m, clusters[k].mask)
    if (s > bestScore) {
      bestScore = s
      best = k
    }
  }
  if (best < 0) {
    clusters.push({ mask: gl.m, members: [] })
    best = clusters.length - 1
  }
  clusters[best].members.push(gi)
  clusterOf[gi] = best
}
const clusterDigit = []
for (let k = 0; k < clusters.length; k++) {
  const votes = new Array(10).fill(0)
  let count = 0
  for (const gi of clusters[k].members) {
    const r = bestDigit(analyzed.glyphs[gi].m, chosen)
    votes[r.digit] += r.score
    count++
  }
  let digit = 0
  for (let d = 1; d < 10; d++) if (votes[d] > votes[digit]) digit = d
  const sortedVotes = votes.slice().sort((a, b) => b - a)
  clusterDigit[k] = {
    digit,
    count,
    score: count ? sortedVotes[0] / count : 0,
    margin: count ? (sortedVotes[0] - sortedVotes[1]) / count : 0,
    manual: manualMap[k] !== undefined,
    final: manualMap[k] !== undefined ? manualMap[k] : digit,
  }
}
console.log(
  `[import] 字体自动择优：${chosen.fam} ${chosen.weight} / ${chosen.size}px（平均字形相似度 ${chosen.avg.toFixed(3)}），字形簇 ${clusters.length} 个`,
)
for (let k = 0; k < clusters.length; k++) {
  const c = clusterDigit[k]
  const tag = c.manual ? `人工→${c.final}` : `自动→${c.digit}`
  const warn = !c.manual && (c.margin < 0.06 || c.score < 0.72) ? '  ⚠ 低置信' : ''
  console.log(
    `  簇${k}: ${tag}（n=${c.count}，相似度 ${c.score.toFixed(3)}，与次优差 ${c.margin.toFixed(3)}）${warn}`,
  )
}
const lowConfidence = clusterDigit.some((c) => !c.manual && (c.margin < 0.06 || c.score < 0.72))
if (lowConfidence) {
  console.warn(
    '[import] 存在低置信字形簇：可用 --map 0=3,1=2 人工指定；不指定时仍按自动结果继续。',
  )
}

// 组装每行/每列数字
const groupDigits = new Map()
for (let gi = 0; gi < analyzed.glyphs.length; gi++) {
  const gl = analyzed.glyphs[gi]
  if (!groupDigits.has(gl.group)) groupDigits.set(gl.group, [])
  groupDigits.get(gl.group).push({ ...gl, digit: clusterDigit[clusterOf[gi]].final })
}
const readSum = (group) => {
  const list = groupDigits.get(group) || []
  const ordered = list.slice().sort((a, b) => a.x - b.x || a.y - b.y)
  return Number(ordered.map((o) => o.digit).join(''))
}
const rowSums = []
const colSums = []
for (let j = 0; j < analyzed.h; j++) rowSums.push(readSum(`r${j}`))
for (let i = 0; i < analyzed.w; i++) colSums.push(readSum(`c${i}`))

const missRow = rowSums.map((v, i) => (v > 0 ? -1 : i)).filter((i) => i >= 0)
const missCol = colSums.map((v, i) => (v > 0 ? -1 : i)).filter((i) => i >= 0)
if (missRow.length || missCol.length) {
  console.error(
    `[import] 有行列和数字缺失：行 ${missRow.join(',') || '无'}；列 ${missCol.join(',') || '无'}。可用 --width/--height/--thick 或 --map 修正。`,
  )
  process.exit(1)
}

/* ═══════════════════════════ 预览 ═══════════════════════════ */
const { w, h, tanks, tankCount, tankSizes } = analyzed
console.log(
  `[import] ${path.basename(imagePath)}：${analyzed.W}×${analyzed.H} 像素，网格 ${w}×${h}，水箱 ${tankCount} 个，` +
    `线宽 细 ${analyzed.lineThin}px / 粗 ${analyzed.lineThick}px（阈值 ${analyzed.thick}px）`,
)
const tankSuspicious = tankSizes.some((s) => s < 2) || tankCount < 2
if (tankSuspicious) {
  console.warn(
    `[import] 水箱划分可疑：最小 ${Math.min(...tankSizes)} 格，共 ${tankCount} 个。可用 --thick 调整粗细阈值后重试。`,
  )
}
console.log('[import] 水箱矩阵：')
const base36 = '0123456789abcdefghijklmnopqrstuvwxyz'
for (let y = 0; y < h; y++) {
  console.log(
    '  ' +
      tanks
        .slice(y * w, y * w + w)
        .map((t) => base36[t % 36])
        .join(''),
  )
}
console.log('[import] 行和：', rowSums.join(','))
console.log('[import] 列和：', colSums.join(','))
const total = rowSums.reduce((a, b) => a + b, 0)
const totalCol = colSums.reduce((a, b) => a + b, 0)
if (total !== totalCol) {
  console.warn(`[import] 行列和总和不一致（行 ${total} / 列 ${totalCol}），数字识别可能有误。`)
} else {
  console.log(`[import] 行列和总和一致：${total}`)
}

if (dry) {
  console.log('[import] --dry：仅识别预览，不求解、不写入。')
  process.exit(0)
}

/* ═══════════════════════════ 求解 / 唯一性（子进程隔离） ═══════════════════════════ */
function runSolverChild(code, payload, timeoutMs, solverPath) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        IMPORT_SOLVER: pathToFileURL(solverPath).href,
        IMPORT_PAYLOAD: JSON.stringify(payload),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    const timer = setTimeout(() => {
      child.kill()
      resolve({ status: 'timeout', stdout, stderr })
    }, timeoutMs)
    child.on('close', (code2) => {
      clearTimeout(timer)
      resolve({ status: code2 === 0 ? 'ok' : 'crash', code: code2, stdout, stderr })
    })
  })
}

const verifyTimeout = Number(arg('--verify-timeout', '120000')) || 120000
const size = w * h
let solution = ''
const t0 = Date.now()
if (verify) {
  const res = await runSolverChild(
    `
const mod = await import(process.env.IMPORT_SOLVER)
const p = JSON.parse(process.env.IMPORT_PAYLOAD)
const counted = mod.countSolutions(p.tanks, p.rowSums, p.colSums, p.size, p.w, p.h, 2, p.maxNodes)
let solution = ''
if (counted.count === 1 && !counted.timedOut) {
  const s = mod.solvePuzzle(
    { id: 'import-temp', name: 'import-temp', width: p.w, height: p.h, difficulty: 'hard', tanks: p.tanks, rowSums: p.rowSums, colSums: p.colSums },
    p.maxNodes,
  )
  if (s.solved && s.solution) solution = s.solution.cells.join('')
}
console.log(JSON.stringify({ count: counted.count, nodes: counted.nodes, timedOut: counted.timedOut, solution }))
`,
    { tanks, rowSums, colSums, size, w, h, maxNodes: maxNodesOpt },
    verifyTimeout,
    'src/game/solver.ts',
  )
  if (res.status === 'ok') {
    const line = res.stdout.trim().split('\n').filter(Boolean).pop() || '{}'
    let data = {}
    try {
      data = JSON.parse(line)
    } catch {
      data = {}
    }
    if (data.timedOut) {
      console.warn(
        `[import] 唯一性检查超时（${data.nodes} 节点，${Date.now() - t0}ms）：未能确认唯一解，条目不写参考解。可加 --verify-timeout/--max-nodes 放宽。`,
      )
    } else if (data.count === 0) {
      console.error(`[import] 求解无解：行列和或水箱识别有误（${data.nodes} 节点）。`)
      process.exit(1)
    } else if (data.count !== 1) {
      console.error(`[import] 解不唯一：${data.count} 个（${data.nodes} 节点）。`)
      process.exit(1)
    } else {
      console.log(`[import] 唯一解校验通过（${data.nodes} 节点，${Date.now() - t0}ms）`)
      if (data.solution) {
        solution = data.solution
        console.log(`[import] 已生成参考解（${solution.length} 格）`)
      }
    }
  } else if (res.status === 'timeout') {
    console.warn(`[import] 唯一性检查超过 ${verifyTimeout}ms 未完成（已终止）：未确认唯一解，条目不写参考解。`)
  } else {
    console.warn(
      `[import] 唯一性检查子进程异常退出（${res.code}，可能题板过大/内存不足）：未确认唯一解，条目不写参考解。`,
    )
  }
} else {
  console.log('[import] 未加 --verify：跳过唯一解校验。')
}

const id = arg('--id', `aquarium-import-${Date.now().toString(36)}`)
const board =
  tanks.map((t) => base36[t % 36]).join('') + '|' + rowSums.join(',') + '|' + colSums.join(',')

if (!append) {
  console.log('[import] 预览模式（未写入）。加 --append 写入 src/game/puzzles-data.ts。')
  process.exit(0)
}

const dataFile = path.resolve('src/game/puzzles-data.ts')
if (!fs.existsSync(dataFile)) {
  console.error('[import] 找不到 src/game/puzzles-data.ts')
  process.exit(1)
}
const entry = `  { id: ${JSON.stringify(id)}, name: ${JSON.stringify(name)}, width: ${w}, height: ${h}, difficulty: 'hard', series: ${JSON.stringify(series)}, board: ${JSON.stringify(board)}, solution: ${JSON.stringify(solution)} },\n`
let text = fs.readFileSync(dataFile, 'utf8').replace(/\r\n/g, '\n')
const marker = text.lastIndexOf('\n]')
if (marker < 0) {
  console.error('[import] puzzles-data.ts 格式异常：找不到结尾 ]')
  process.exit(1)
}
text = text.slice(0, marker + 1) + '\n' + entry + text.slice(marker + 1)
fs.writeFileSync(dataFile, text)
console.log(`[import] 已写入 ${dataFile}：${id} ${name}`)
