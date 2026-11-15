/**
 * 水箱 —— 逻辑解题回放计划
 */

import type { GameState, LogicPlan, PlaybackFrame, Puzzle } from '../core/types'
import { isValidSolution, propagate, type RuleKind } from './rules'
import {
  asAquaPuzzle,
  asAquaState,
  EMPTY,
  FILLED,
  MARK,
  type AquariumState,
} from './types'

const RULE_INFO: Record<RuleKind | 'probe' | 'search', { rule: number; label: string }> = {
  tank: { rule: 1, label: '水箱水位：同行同状态，水位以下注水' },
  sum: { rule: 2, label: '行列注水总数限制' },
  probe: { rule: 3, label: '反证：另一种状态会立刻矛盾' },
  search: { rule: 4, label: '回溯试探：该格最终是这一状态' },
}

function fallbackSolve(
  grid: number[],
  tanks: number[],
  rowSums: number[],
  colSums: number[],
  w: number,
  h: number,
  maxNodes: number,
): number[] | null {
  const size = w * h
  let nodes = 0
  let timedOut = false
  const work = grid.slice()
  const dfs = (): number[] | null => {
    if (timedOut) return null
    nodes++
    if (nodes > maxNodes) {
      timedOut = true
      return null
    }
    if (!propagate(work, tanks, rowSums, colSums, w, h)) return null
    let choice = -1
    for (let i = 0; i < size; i++) {
      if (work[i] === EMPTY) {
        choice = i
        break
      }
    }
    if (choice < 0) {
      return isValidSolution(work, tanks, rowSums, colSums, w, h) ? Array.from(work) : null
    }
    const backup = work.slice()
    for (const value of [FILLED, MARK] as const) {
      work[choice] = value
      const found = dfs()
      if (found) return found
      for (let i = 0; i < size; i++) work[i] = backup[i]!
      if (timedOut) return null
    }
    return null
  }
  return dfs()
}

export function planLogicSolve(puzzle: Puzzle, initialState: GameState): LogicPlan {
  const p = asAquaPuzzle(puzzle)
  const s = asAquaState(initialState)
  const w = s.width
  const h = s.height
  const size = w * h
  const tanks = p.tanks ?? []
  const rowSums = p.rowSums ?? []
  const colSums = p.colSums ?? []

  const emptyPlan: LogicPlan = {
    puzzleId: p.id,
    frames: [],
    finalState: null,
    ruleSteps: 0,
    saturated: false,
  }
  if (tanks.length !== size) return emptyPlan

  const grid = s.cells.slice()
  const displayed = s.cells.slice()
  const frames: PlaybackFrame[] = []
  let lastKind = ''
  let streak = 0
  const emit = (index: number, to: number, kind: RuleKind | 'probe' | 'search'): void => {
    const from = displayed[index] ?? EMPTY
    if (from === to) return
    displayed[index] = to
    if (kind === lastKind) streak++
    else {
      lastKind = kind
      streak = 1
    }
    frames.push({ rule: RULE_INFO[kind].rule, label: RULE_INFO[kind].label, move: { index, from, to }, streak })
  }
  const onSet = (index: number, value: number, kind: RuleKind): void => emit(index, value, kind)

  if (!propagate(grid, tanks, rowSums, colSums, w, h, onSet)) return emptyPlan

  let saturated = true
  for (let round = 0; round < size * 2; round++) {
    let unknown = -1
    for (let i = 0; i < size; i++) {
      if (grid[i] === EMPTY) {
        unknown = i
        break
      }
    }
    if (unknown < 0) break
    if (frames.length > 8000) {
      saturated = false
      break
    }
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
      if (filledImpossible && markImpossible) return emptyPlan
      if (filledImpossible !== markImpossible) {
        forced.push({ index: i, value: filledImpossible ? MARK : FILLED })
      }
    }
    if (!forced.length) {
      saturated = false
      break
    }
    for (const { index, value } of forced) {
      if (grid[index] === EMPTY) {
        grid[index] = value
        emit(index, value, 'probe')
      }
    }
    if (!propagate(grid, tanks, rowSums, colSums, w, h, onSet)) return emptyPlan
  }

  let stillUnknown = false
  for (let i = 0; i < size; i++) {
    if (grid[i] === EMPTY) {
      stillUnknown = true
      break
    }
  }
  if (stillUnknown) {
    const found = fallbackSolve(grid, tanks, rowSums, colSums, w, h, 800_000)
    if (!found) return emptyPlan
    for (let i = 0; i < size; i++) {
      if (grid[i] === found[i]) continue
      grid[i] = found[i]!
      emit(i, found[i]!, 'search')
    }
    saturated = false
  }

  const finalState: AquariumState = {
    puzzleId: s.puzzleId,
    width: w,
    height: h,
    cells: Array.from(grid),
    givens: s.givens.slice(),
  }
  return { puzzleId: p.id, frames, finalState, ruleSteps: frames.length, saturated }
}
