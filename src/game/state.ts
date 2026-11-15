/**
 * 水箱 —— 棋盘状态
 */

import type { GameState, HitTarget, Move, Puzzle } from '../core/types'
import {
  asAquaPuzzle,
  asAquaState,
  decodeCells,
  EMPTY,
  encodeCells,
  FILLED,
  MARK,
  type AquariumState,
} from './types'

export function createEmptyState(puzzle: Puzzle): AquariumState {
  const p = asAquaPuzzle(puzzle)
  const size = p.width * p.height
  return {
    puzzleId: p.id,
    width: p.width,
    height: p.height,
    cells: new Array<number>(size).fill(EMPTY),
    givens: new Array<number>(size).fill(EMPTY),
  }
}

export function cloneState(state: GameState): AquariumState {
  const s = asAquaState(state)
  return {
    puzzleId: s.puzzleId,
    width: s.width,
    height: s.height,
    cells: s.cells.slice(),
    givens: s.givens.slice(),
  }
}

export function cycleValue(state: GameState, target: HitTarget): number {
  const s = asAquaState(state)
  const v = s.cells[target.index] ?? EMPTY
  if (v === EMPTY) return FILLED
  if (v === FILLED) return MARK
  return EMPTY
}

export function rightClickValue(state: GameState, target: HitTarget): number {
  const s = asAquaState(state)
  return s.cells[target.index] === MARK ? EMPTY : MARK
}

export function applyMove(state: GameState, move: Move): void {
  const s = asAquaState(state)
  if (move.index < 0 || move.index >= s.cells.length) return
  s.cells[move.index] = move.to === FILLED || move.to === MARK ? move.to : EMPTY
}

export function invertMove(move: Move): Move {
  return { index: move.index, from: move.to, to: move.from }
}

export function valueAt(state: GameState, index: number): number {
  return asAquaState(state).cells[index] ?? EMPTY
}

export function serializeState(state: GameState): Record<string, unknown> {
  const s = asAquaState(state)
  return {
    version: 1,
    puzzleId: s.puzzleId,
    width: s.width,
    height: s.height,
    cells: encodeCells(s.cells),
  }
}

function readCells(value: unknown, size: number): number[] | null {
  if (typeof value === 'string') return decodeCells(value, size)
  if (Array.isArray(value)) {
    if (value.length !== size) return null
    const out: number[] = []
    for (const v of value) {
      const n = Number(v)
      if (n !== EMPTY && n !== FILLED && n !== MARK) return null
      out.push(n)
    }
    return out
  }
  return null
}

export function deserializeState(data: Record<string, unknown>): AquariumState | null {
  if (typeof data.puzzleId !== 'string') return null
  if (typeof data.width !== 'number' || typeof data.height !== 'number') return null
  const w = data.width
  const h = data.height
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) return null
  const size = w * h
  const cells = readCells(data.cells, size)
  if (!cells) return null
  return {
    puzzleId: data.puzzleId,
    width: w,
    height: h,
    cells,
    givens: new Array<number>(size).fill(EMPTY),
  }
}

export function firstHintMove(state: GameState, solution: GameState): Move | null {
  const s = asAquaState(state)
  const sol = asAquaState(solution)
  const size = Math.min(s.cells.length, sol.cells.length)
  for (let i = 0; i < size; i++) {
    if (sol.cells[i] === FILLED && s.cells[i] !== FILLED) {
      return { index: i, from: s.cells[i]!, to: FILLED }
    }
  }
  for (let i = 0; i < size; i++) {
    if (sol.cells[i] !== FILLED && s.cells[i] === FILLED) {
      return { index: i, from: FILLED, to: MARK }
    }
  }
  return null
}
