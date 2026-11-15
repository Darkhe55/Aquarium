/**
 * 水箱 —— 实时校验
 */

import type { GameState, Puzzle, ValidationResult } from '../core/types'
import { isValidSolution } from './rules'
import {
  asAquaPuzzle,
  asAquaState,
  EMPTY,
  FILLED,
  MARK,
  type AquariumResult,
  type LineIssue,
  type TankIssue,
} from './types'

export function validate(state: GameState, puzzle: Puzzle): AquariumResult {
  const s = asAquaState(state)
  const p = asAquaPuzzle(puzzle)
  const w = s.width
  const h = s.height
  const size = w * h
  const cells = s.cells
  const tanks = p.tanks ?? []
  const rowSums = p.rowSums ?? []
  const colSums = p.colSums ?? []

  let empty = 0
  let filled = 0
  for (let i = 0; i < size; i++) {
    if (cells[i] === EMPTY) empty++
    else if (cells[i] === FILLED) filled++
  }

  let tankCount = 0
  for (const t of tanks) if (t + 1 > tankCount) tankCount = t + 1

  const bad = new Set<number>()
  const tankIssues: TankIssue[] = []

  for (let t = 0; t < tankCount; t++) {
    const groups = new Map<number, number[]>()
    for (let i = 0; i < size; i++) {
      if (tanks[i] !== t) continue
      const y = (i / w) | 0
      const list = groups.get(y) ?? []
      list.push(i)
      groups.set(y, list)
    }
    const rows = Array.from(groups.entries()).sort((a, b) => a[0] - b[0])

    for (const [, list] of rows) {
      const hasFilled = list.some((i) => cells[i] === FILLED)
      const hasMark = list.some((i) => cells[i] === MARK)
      if (hasFilled && hasMark) {
        tankIssues.push({ tank: t, reason: 'row-mixed' })
        for (const i of list) bad.add(i)
      }
    }

    for (let a = 0; a < rows.length; a++) {
      for (let b = a + 1; b < rows.length; b++) {
        const upper = rows[a]![1]
        const lower = rows[b]![1]
        const upperFilled = upper.some((i) => cells[i] === FILLED)
        const lowerMark = lower.some((i) => cells[i] === MARK)
        if (upperFilled && lowerMark) {
          tankIssues.push({ tank: t, reason: 'water-level' })
          for (const i of upper) bad.add(i)
          for (const i of lower) bad.add(i)
        }
      }
    }
  }

  const sumIssues: LineIssue[] = []
  for (let y = 0; y < h; y++) {
    const target = rowSums[y] ?? 0
    let count = 0
    let unknown = 0
    for (let x = 0; x < w; x++) {
      const v = cells[y * w + x]
      if (v === FILLED) count++
      else if (v === EMPTY) unknown++
    }
    if (count > target || count + unknown < target || (unknown === 0 && count !== target)) {
      sumIssues.push({ orientation: 'row', index: y, filled: count, target })
      if (unknown === 0 || count + unknown < target) {
        for (let x = 0; x < w; x++) bad.add(y * w + x)
      }
    }
  }
  for (let x = 0; x < w; x++) {
    const target = colSums[x] ?? 0
    let count = 0
    let unknown = 0
    for (let y = 0; y < h; y++) {
      const v = cells[y * w + x]
      if (v === FILLED) count++
      else if (v === EMPTY) unknown++
    }
    if (count > target || count + unknown < target || (unknown === 0 && count !== target)) {
      sumIssues.push({ orientation: 'col', index: x, filled: count, target })
      if (unknown === 0 || count + unknown < target) {
        for (let y = 0; y < h; y++) bad.add(y * w + x)
      }
    }
  }

  const normalized = cells.map((v) => (v === FILLED ? FILLED : MARK))
  const solved =
    tankIssues.length === 0 &&
    sumIssues.length === 0 &&
    isValidSolution(normalized, tanks, rowSums, colSums, w, h)

  return {
    solved,
    empty,
    complete: empty === 0,
    filled,
    tankIssues,
    sumIssues,
    badCells: Array.from(bad),
  }
}

export function statusBits(result: ValidationResult): string[] {
  const r = result as AquariumResult
  if (r.solved) return ['完成']
  const bits: string[] = []
  if (typeof r.empty === 'number' && r.empty > 0) bits.push(`还需填 ${r.empty} 格`)
  if (r.tankIssues.length > 0) bits.push(`${r.tankIssues.length} 处水箱水位冲突`)
  if (r.sumIssues.length > 0) {
    const rows = r.sumIssues.filter((x) => x.orientation === 'row').length
    const cols = r.sumIssues.length - rows
    if (rows > 0) bits.push(`${rows} 行数字不满足`)
    if (cols > 0) bits.push(`${cols} 列数字不满足`)
  }
  if (bits.length === 0) bits.push('继续注水')
  return bits
}
