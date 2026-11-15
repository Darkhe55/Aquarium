/**
 * ════════════════════════════════════════════════════════════════════
 *  水箱（Aquarium）—— 游戏适配器
 * ════════════════════════════════════════════════════════════════════
 *
 * 规则：每个水箱有水平水位；同一水箱同一行同状态；盘外数字 = 行列注水数。
 *
 * 状态用 0/1/2：0 = 未定，1 = 注水，2 = 空。
 */

import { playDrop, playPluck } from '../core/audio'
import type { CustomSupport, GameAdapter, Move, Puzzle, SolveResult } from '../core/types'
import { planLogicSolve } from './logic'
import { builtinPuzzles, getReferenceSolution } from './puzzles'
import { hitTest, metricsFor, renderBoard } from './render'
import { countSolutions, solvePuzzle } from './solver'
import {
  applyMove,
  cloneState,
  createEmptyState,
  cycleValue,
  deserializeState,
  firstHintMove,
  invertMove,
  rightClickValue,
  serializeState,
  valueAt,
} from './state'
import { statusBits, validate } from './validate'
import {
  decodeBoard,
  encodeBoard,
  FILLED,
  normalizeRegions,
  type AquariumPuzzle,
} from './types'

const meta = {
  title: '水箱',
  tagline: '每个水箱一条水平水位 —— 行列数字告诉你注了多少格',
  footerNote:
    '规则：每个水箱有一个水平水位，同一水箱同一行的格子同时注水或同时为空；水位以下注水、以上为空；盘外数字表示该行/列注水的格子总数。',
  storageKeyPrefix: 'aquarium',
  customIdPrefix: 'aquarium-custom-',
  customMinW: 5,
  customMinH: 5,
  customMaxW: 35,
  customMaxH: 35,
  targetKind: 'cell' as const,
}

function readNumberList(id: string, count: number, max: number, fallback: number[]): number[] {
  const el = document.getElementById(id) as HTMLTextAreaElement | null
  const raw = el?.value.trim() ?? ''
  const vals = raw ? raw.split(/[\s,，]+/).filter(Boolean).map(Number) : []
  const out: number[] = []
  for (let i = 0; i < count; i++) {
    const n = Number.isFinite(vals[i]) ? vals[i]! : fallback[i] ?? 0
    out.push(Math.max(0, Math.min(max, Math.round(n))))
  }
  return out
}

const custom: CustomSupport = {
  mode: 'region',
  valueCycle: [null, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
  keyForDigit: (digit) => {
    if (digit === 0) return null
    if (digit >= 1 && digit <= 20) return digit
    return undefined
  },
  cellLabel: (v) => (v == null ? '' : String(v)),
  cellClass: (v) => (v == null ? '' : `r${v}`),
  hint: '先用相同区域号涂出每个水箱，再在下方输入每行/每列注水格数。',

  extras: {
    html: () => `
      <div class="custom-extras-grid">
        <label>行注水数（从上到下，共 h 个）
          <textarea id="custom-row-sums" rows="2" spellcheck="false"></textarea>
        </label>
        <label>列注水数（从左到右，共 w 个）
          <textarea id="custom-col-sums" rows="2" spellcheck="false"></textarea>
        </label>
        <div class="custom-hint">数值范围 0..行宽/列高；不填按 0 处理。</div>
      </div>`,
    mount: () => undefined,
    reset: (ctl) => {
      const r = document.getElementById('custom-row-sums') as HTMLTextAreaElement | null
      const c = document.getElementById('custom-col-sums') as HTMLTextAreaElement | null
      if (r) r.value = new Array<number>(ctl.height).fill(0).join(' ')
      if (c) c.value = new Array<number>(ctl.width).fill(0).join(' ')
    },
    load: (p) => {
      const ap = p as AquariumPuzzle
      const r = document.getElementById('custom-row-sums') as HTMLTextAreaElement | null
      const c = document.getElementById('custom-col-sums') as HTMLTextAreaElement | null
      if (r) r.value = (ap.rowSums ?? []).join(' ')
      if (c) c.value = (ap.colSums ?? []).join(' ')
    },
  },

  toGrid: (p) => {
    const ap = p as AquariumPuzzle
    if (!Array.isArray(ap.tanks) || ap.tanks.length !== p.width * p.height) return null
    return {
      width: p.width,
      height: p.height,
      grid: ap.tanks.map((t) => (typeof t === 'number' && t >= 0 ? t + 1 : null)),
    }
  },

  makePuzzle: (w, h, grid, existingId) => {
    const raw = grid.map((v) => (typeof v === 'number' && v >= 1 ? v : -1))
    const tanks = normalizeRegions(raw)
    const fallbackRows = new Array<number>(h).fill(0)
    const fallbackCols = new Array<number>(w).fill(0)
    const rowSums = readNumberList('custom-row-sums', h, w, fallbackRows)
    const colSums = readNumberList('custom-col-sums', w, h, fallbackCols)
    return {
      id: existingId ?? `${meta.customIdPrefix}${w}x${h}-${Date.now()}`,
      name: `自定义 · ${w}×${h}`,
      width: w,
      height: h,
      difficulty: 'custom',
      tanks,
      rowSums,
      colSums,
    } satisfies AquariumPuzzle
  },

  encodePuzzle: (p) => {
    const ap = p as AquariumPuzzle
    return { board: encodeBoard(ap.tanks ?? [], ap.rowSums ?? [], ap.colSums ?? []) }
  },

  decodePuzzle: (record) => {
    if (typeof record.id !== 'string') return null
    if (typeof record.width !== 'number' || typeof record.height !== 'number') return null
    const w = record.width
    const h = record.height
    if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) return null
    if (typeof record.board !== 'string') return null
    const decoded = decodeBoard(record.board, w * h, w, h)
    if (!decoded) return null
    return {
      id: record.id,
      name: typeof record.name === 'string' ? record.name : `自定义 · ${w}×${h}`,
      width: w,
      height: h,
      difficulty: 'custom',
      tanks: decoded.tanks,
      rowSums: decoded.rowSums,
      colSums: decoded.colSums,
    } satisfies AquariumPuzzle
  },

  audit: (p) => {
    const ap = p as AquariumPuzzle
    const w = ap.width
    const h = ap.height
    if (w * h > 400) return { ok: true, message: '大盘面跳过唯一解校验。' }
    const out = countSolutions(ap.tanks ?? [], ap.rowSums ?? [], ap.colSums ?? [], w * h, w, h, 2, 300_000)
    if (out.timedOut) return { ok: true, message: '唯一解校验超时，仍可保存。' }
    if (out.count === 0) return { ok: false, message: '当前盘面无解，请检查水箱区域与行列数字。' }
    if (out.count > 1) return { ok: true, message: '注意：当前题面存在多个解。' }
    return { ok: true, message: '唯一解 ✓。' }
  },
}


function playForMove(move: Move, streak: number): void {
  if (move.to === FILLED) playPluck(streak, 1.1)
  else playDrop(streak)
}

export const adapter: GameAdapter = {
  meta,
  builtinPuzzles,
  getReferenceSolution,
  createEmptyState,
  cloneState,
  cycleValue,
  rightClickValue,
  applyMove,
  invertMove,
  valueAt,
  serializeState,
  deserializeState,
  validate,
  statusBits,
  metricsFor,
  renderBoard,
  hitTest,
  planLogicSolve,
  solvePuzzle: (puzzle: Puzzle, maxNodes?: number): SolveResult => solvePuzzle(puzzle, maxNodes),
  firstHintMove,
  custom,
  playForMove,
}
