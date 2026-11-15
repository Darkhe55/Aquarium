/**
 * 水箱题库生成器
 *
 * 1. 随机分成若干连通水箱；
 * 2. 每个水箱随机选一个水平水位，注水水位以下的格子；
 * 3. 计算行列和，用求解器验证唯一解。
 */

import type { Difficulty } from '../core/types'
import { FILLED, MARK, encodeBoard, encodeCells } from './types.ts'
import { solveByRules } from './rules.ts'
import { countSolutions } from './solver.ts'

export interface RawPuzzleOut {
  id: string
  name: string
  width: number
  height: number
  difficulty: Difficulty
  series: string
  board: string
  solution: string
}

interface GenSpec {
  w: number
  h: number
  tanks: number
  seed: number
  difficulty: Difficulty
  name: string
  series: string
  attempts: number
  maxNodes: number
  requireLogic: boolean
}

function mulberry32(a: number): () => number {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle<T>(list: T[], rng: () => number): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = list[i]!
    list[i] = list[j]!
    list[j] = tmp
  }
  return list
}

function partition(w: number, h: number, k: number, rng: () => number): number[] | null {
  const n = w * h
  const owner = new Array<number>(n).fill(-1)
  const sizes = new Array<number>(k).fill(0)
  const frontiers: Array<Set<number>> = Array.from({ length: k }, () => new Set<number>())

  const addNeighbors = (g: number, cell: number): void => {
    const x = cell % w
    const y = (cell / w) | 0
    if (x > 0 && owner[cell - 1] === -1) frontiers[g]!.add(cell - 1)
    if (x + 1 < w && owner[cell + 1] === -1) frontiers[g]!.add(cell + 1)
    if (y > 0 && owner[cell - w] === -1) frontiers[g]!.add(cell - w)
    if (y + 1 < h && owner[cell + w] === -1) frontiers[g]!.add(cell + w)
  }

  const order = shuffle(
    Array.from({ length: n }, (_, i) => i),
    rng,
  )
  for (let g = 0; g < k; g++) {
    const seed = order[g]!
    owner[seed] = g
    sizes[g] = 1
    addNeighbors(g, seed)
  }

  let assigned = k
  while (assigned < n) {
    let minSize = Infinity
    for (let g = 0; g < k; g++) {
      let has = false
      for (const c of frontiers[g]!) if (owner[c] === -1) { has = true; break }
      if (has && sizes[g]! < minSize) minSize = sizes[g]!
    }
    if (!Number.isFinite(minSize)) return null
    const candidates: number[] = []
    for (let g = 0; g < k; g++) {
      let has = false
      for (const c of frontiers[g]!) if (owner[c] === -1) { has = true; break }
      if (has && sizes[g]! <= minSize + 1) candidates.push(g)
    }
    const g = candidates[Math.floor(rng() * candidates.length)]!
    const list: number[] = []
    for (const c of frontiers[g]!) if (owner[c] === -1) list.push(c)
    const cell = list[Math.floor(rng() * list.length)]!
    owner[cell] = g
    sizes[g]!++
    assigned++
    addNeighbors(g, cell)
  }
  return owner
}

interface AttemptStats {
  partitionFail: number
  notUnique: number
  timeout: number
  empty: number
}

function attemptPuzzle(
  spec: GenSpec,
  rng: () => number,
  stats: AttemptStats,
): { tanks: number[]; rowSums: number[]; colSums: number[]; solution: number[] } | null {
  const { w, h } = spec
  const size = w * h
  const tanks = partition(w, h, spec.tanks, rng)
  if (!tanks) {
    stats.partitionFail++
    return null
  }

  const cells = new Array<number>(size).fill(MARK)
  for (let t = 0; t < spec.tanks; t++) {
    const level = Math.floor(rng() * (h + 1))
    for (let i = 0; i < size; i++) {
      if (tanks[i] === t && Math.floor(i / w) >= level) cells[i] = FILLED
    }
  }

  let filled = 0
  for (const v of cells) if (v === FILLED) filled++
  if (filled === 0 || filled === size) {
    stats.empty++
    return null
  }

  const rowSums = new Array<number>(h).fill(0)
  const colSums = new Array<number>(w).fill(0)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (cells[y * w + x] === FILLED) {
        rowSums[y]!++
        colSums[x]!++
      }
    }
  }

  const counted = countSolutions(tanks, rowSums, colSums, size, w, h, 2, spec.maxNodes)
  if (counted.timedOut) {
    stats.timeout++
    return null
  }
  if (counted.count !== 1) {
    stats.notUnique++
    return null
  }

  if (spec.requireLogic) {
    solveByRules(tanks, rowSums, colSums, size, w, h, true, 240)
  }

  return { tanks, rowSums, colSums, solution: cells }
}

const SPECS: GenSpec[] = [
  {
    w: 6,
    h: 6,
    tanks: 4,
    seed: 0x41515501,
    difficulty: 'easy',
    name: '初识水箱',
    series: '入门',
    attempts: 500,
    maxNodes: 80_000,
    requireLogic: true,
  },
  {
    w: 7,
    h: 7,
    tanks: 5,
    seed: 0x41515502,
    difficulty: 'easy',
    name: '七箱水影',
    series: '入门',
    attempts: 700,
    maxNodes: 100_000,
    requireLogic: true,
  },
  {
    w: 8,
    h: 8,
    tanks: 6,
    seed: 0x41515503,
    difficulty: 'medium',
    name: '水位回廊',
    series: '进阶',
    attempts: 900,
    maxNodes: 120_000,
    requireLogic: false,
  },
  {
    w: 8,
    h: 8,
    tanks: 7,
    seed: 0x41515504,
    difficulty: 'medium',
    name: '注水迷阵',
    series: '进阶',
    attempts: 1100,
    maxNodes: 120_000,
    requireLogic: false,
  },
  {
    w: 8,
    h: 8,
    tanks: 8,
    seed: 0x41515505,
    difficulty: 'hard',
    name: '满溢之箱',
    series: '挑战',
    attempts: 1300,
    maxNodes: 150_000,
    requireLogic: false,
  },
  {
    w: 8,
    h: 8,
    tanks: 9,
    seed: 0x41515506,
    difficulty: 'hard',
    name: '水箱终局',
    series: '挑战',
    attempts: 1500,
    maxNodes: 150_000,
    requireLogic: false,
  },
]

export function generatePuzzles(): RawPuzzleOut[] {
  const out: RawPuzzleOut[] = []
  for (const spec of SPECS) {
    const rng = mulberry32(spec.seed)
    const stats: AttemptStats = {
      partitionFail: 0,
      notUnique: 0,
      timeout: 0,
      empty: 0,
    }
    let made: {
      tanks: number[]
      rowSums: number[]
      colSums: number[]
      solution: number[]
    } | null = null
    const t0 = Date.now()
    for (let attempt = 0; attempt < spec.attempts; attempt++) {
      made = attemptPuzzle(spec, rng, stats)
      if (made) break
    }
    if (!made) {
      console.error(`[水箱 gen] ${spec.name} 失败统计：`, stats)
      throw new Error(`[水箱 gen] ${spec.name} 在 ${spec.attempts} 次尝试内没有生成合法题`)
    }
    const filled = made.solution.filter((v) => v === FILLED).length
    console.log(
      `[水箱 gen] ${spec.name} ${spec.w}×${spec.h}：水箱 ${spec.tanks}，注水 ${filled}，${Date.now() - t0}ms`,
    )
    out.push({
      id: `aquarium-${spec.w}x${spec.h}-${spec.seed.toString(36)}`,
      name: spec.name,
      width: spec.w,
      height: spec.h,
      difficulty: spec.difficulty,
      series: spec.series,
      board: encodeBoard(made.tanks, made.rowSums, made.colSums),
      solution: encodeCells(made.solution),
    })
  }
  return out
}
