/**
 * 水箱 —— 规则引擎
 */

import { EMPTY, FILLED, MARK } from './types.ts'

export type RuleKind = 'tank' | 'sum'

export type SetCallback = (index: number, value: number, rule: RuleKind) => void

interface RowGroup {
  y: number
  cells: number[]
  state: number
}

function tankRowGroups(
  cells: ArrayLike<number>,
  tanks: ArrayLike<number>,
  w: number,
  h: number,
  tank: number,
): RowGroup[] {
  const map = new Map<number, number[]>()
  for (let i = 0; i < w * h; i++) {
    if (tanks[i] !== tank) continue
    const y = (i / w) | 0
    const list = map.get(y) ?? []
    list.push(i)
    map.set(y, list)
  }
  const groups: RowGroup[] = []
  for (const [y, list] of map) {
    let state = EMPTY
    if (list.some((i) => cells[i] === FILLED)) state = FILLED
    else if (list.every((i) => cells[i] === MARK)) state = MARK
    groups.push({ y, cells: list, state })
  }
  groups.sort((a, b) => a.y - b.y)
  return groups
}

export function propagate(
  cells: Int8Array | number[],
  tanks: ArrayLike<number>,
  rowSums: number[],
  colSums: number[],
  w: number,
  h: number,
  onSet?: SetCallback,
): boolean {
  const size = w * h
  let tankCount = 0
  for (let i = 0; i < size; i++) {
    const t = tanks[i] ?? -1
    if (t + 1 > tankCount) tankCount = t + 1
  }
  let changed = true

  const set = (i: number, value: number, kind: RuleKind): boolean => {
    if (cells[i] === value) return true
    if (cells[i] !== EMPTY) return false
    cells[i] = value
    onSet?.(i, value, kind)
    changed = true
    return true
  }

  while (changed) {
    changed = false

    for (let t = 0; t < tankCount; t++) {
      const groups = tankRowGroups(cells, tanks, w, h, t)

      // 同一行必须同状态
      for (const g of groups) {
        const filled = g.cells.filter((i) => cells[i] === FILLED).length
        const marked = g.cells.filter((i) => cells[i] === MARK).length
        if (filled > 0 && marked > 0) return false
        const target = filled > 0 ? FILLED : marked > 0 ? MARK : EMPTY
        if (target !== EMPTY) {
          for (const i of g.cells) {
            if (cells[i] === EMPTY && !set(i, target, 'tank')) return false
          }
        }
      }

      // 水位：上方注水则下方必注水；下方为空则上方必为空
      for (let a = 0; a < groups.length; a++) {
        for (let b = a + 1; b < groups.length; b++) {
          const upper = groups[a]!
          const lower = groups[b]!
          const upperState = upper.cells.some((i) => cells[i] === FILLED)
            ? FILLED
            : upper.cells.every((i) => cells[i] === MARK)
              ? MARK
              : EMPTY
          const lowerState = lower.cells.some((i) => cells[i] === FILLED)
            ? FILLED
            : lower.cells.every((i) => cells[i] === MARK)
              ? MARK
              : EMPTY
          if (upperState === FILLED && lowerState === MARK) return false
          if (lowerState === MARK && upperState === FILLED) return false
          if (upperState === FILLED) {
            for (const i of lower.cells) {
              if (cells[i] === EMPTY && !set(i, FILLED, 'tank')) return false
            }
          }
          if (lowerState === MARK) {
            for (const i of upper.cells) {
              if (cells[i] === EMPTY && !set(i, MARK, 'tank')) return false
            }
          }
        }
      }
    }

    // 行和
    for (let y = 0; y < h; y++) {
      const target = rowSums[y] ?? 0
      let filled = 0
      const unknown: number[] = []
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        if (cells[i] === FILLED) filled++
        else if (cells[i] === EMPTY) unknown.push(i)
      }
      if (filled > target || filled + unknown.length < target) return false
      if (filled === target) {
        for (const i of unknown) if (!set(i, MARK, 'sum')) return false
      } else if (filled + unknown.length === target) {
        for (const i of unknown) if (!set(i, FILLED, 'sum')) return false
      }
    }

    // 列和
    for (let x = 0; x < w; x++) {
      const target = colSums[x] ?? 0
      let filled = 0
      const unknown: number[] = []
      for (let y = 0; y < h; y++) {
        const i = y * w + x
        if (cells[i] === FILLED) filled++
        else if (cells[i] === EMPTY) unknown.push(i)
      }
      if (filled > target || filled + unknown.length < target) return false
      if (filled === target) {
        for (const i of unknown) if (!set(i, MARK, 'sum')) return false
      } else if (filled + unknown.length === target) {
        for (const i of unknown) if (!set(i, FILLED, 'sum')) return false
      }
    }
  }

  return true
}

export function isValidSolution(
  cells: ArrayLike<number>,
  tanks: ArrayLike<number>,
  rowSums: number[],
  colSums: number[],
  w: number,
  h: number,
): boolean {
  const size = w * h
  let tankCount = 0
  for (let i = 0; i < size; i++) {
    if (cells[i] !== FILLED && cells[i] !== MARK) return false
    const t = tanks[i] ?? -1
    if (t + 1 > tankCount) tankCount = t + 1
  }

  for (let t = 0; t < tankCount; t++) {
    const groups = tankRowGroups(cells, tanks, w, h, t)
    for (const g of groups) {
      const filled = g.cells.filter((i) => cells[i] === FILLED).length
      if (filled !== 0 && filled !== g.cells.length) return false
    }
    for (let a = 0; a < groups.length; a++) {
      for (let b = a + 1; b < groups.length; b++) {
        const upper = groups[a]!
        const lower = groups[b]!
        const upperFilled = upper.cells.every((i) => cells[i] === FILLED)
        const lowerFilled = lower.cells.every((i) => cells[i] === FILLED)
        if (upperFilled && !lowerFilled) return false
      }
    }
  }

  for (let y = 0; y < h; y++) {
    let filled = 0
    for (let x = 0; x < w; x++) if (cells[y * w + x] === FILLED) filled++
    if (filled !== (rowSums[y] ?? 0)) return false
  }
  for (let x = 0; x < w; x++) {
    let filled = 0
    for (let y = 0; y < h; y++) if (cells[y * w + x] === FILLED) filled++
    if (filled !== (colSums[x] ?? 0)) return false
  }
  return true
}

export interface RuleSolveResult {
  ok: boolean
  solution: number[] | null
  contradiction: boolean
  saturated: boolean
  usedProbing: boolean
}

export function solveByRules(
  tanks: number[],
  rowSums: number[],
  colSums: number[],
  size: number,
  w: number,
  h: number,
  probing = true,
  maxRounds = 400,
): RuleSolveResult {
  const grid = new Array<number>(size).fill(EMPTY)
  let usedProbing = false
  for (let round = 0; round < maxRounds; round++) {
    if (!propagate(grid, tanks, rowSums, colSums, w, h)) {
      return { ok: false, solution: null, contradiction: true, saturated: false, usedProbing }
    }
    let unknown = -1
    for (let i = 0; i < size; i++) {
      if (grid[i] === EMPTY) {
        unknown = i
        break
      }
    }
    if (unknown < 0) {
      const solution = Array.from(grid)
      const ok = isValidSolution(solution, tanks, rowSums, colSums, w, h)
      return { ok, solution: ok ? solution : null, contradiction: false, saturated: ok, usedProbing }
    }
    if (!probing) {
      return { ok: false, solution: null, contradiction: false, saturated: false, usedProbing }
    }
    usedProbing = true
    const forced: Array<{ index: number; value: number }> = []
    for (let i = 0; i < size; i++) {
      if (grid[i] !== EMPTY) continue
      let filledImpossible = false
      let markImpossible = false
      {
        const trial = Int8Array.from(grid)
        trial[i] = FILLED
        if (!propagate(trial, tanks, rowSums, colSums, w, h)) filledImpossible = true
      }
      {
        const trial = Int8Array.from(grid)
        trial[i] = MARK
        if (!propagate(trial, tanks, rowSums, colSums, w, h)) markImpossible = true
      }
      if (filledImpossible && markImpossible) {
        return { ok: false, solution: null, contradiction: true, saturated: false, usedProbing }
      }
      if (filledImpossible !== markImpossible) {
        forced.push({ index: i, value: filledImpossible ? MARK : FILLED })
      }
    }
    if (!forced.length) {
      return { ok: false, solution: null, contradiction: false, saturated: false, usedProbing }
    }
    for (const { index, value } of forced) {
      if (grid[index] === EMPTY) grid[index] = value
    }
  }
  return { ok: false, solution: null, contradiction: false, saturated: false, usedProbing }
}
