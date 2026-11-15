/**
 * 水箱（Aquarium）—— 游戏专用类型
 *
 * 规则：
 *   1. 每个水箱有一个水平水位：同一水箱同一行的格子同时有水或同时为空；
 *      水位以下的格子注水，以上的格子为空；
 *   2. 盘外数字表示该行/列注水的格子总数。
 *
 * 状态：0 = 未定，1 = 注水，2 = 空。
 */

import type { GameState, Puzzle, ValidationResult } from '../core/types'

export const EMPTY = 0
export const FILLED = 1
export const MARK = 2

export type CellValue = 0 | 1 | 2

export interface AquariumPuzzle extends Puzzle {
  /** 每格所属水箱号 */
  tanks: number[]
  rowSums: number[]
  colSums: number[]
  /** 参考解：1 注水 / 2 空 */
  solution?: number[]
}

export interface AquariumState extends GameState {
  cells: number[]
  givens: number[]
}

export interface TankIssue {
  tank: number
  reason: 'row-mixed' | 'water-level'
}

export interface LineIssue {
  orientation: 'row' | 'col'
  index: number
  filled: number
  target: number
}

export interface AquariumResult extends ValidationResult {
  empty: number
  complete: boolean
  filled: number
  tankIssues: TankIssue[]
  sumIssues: LineIssue[]
  badCells: number[]
}

export function asAquaPuzzle(p: Puzzle): AquariumPuzzle {
  return p as AquariumPuzzle
}

export function asAquaState(s: GameState): AquariumState {
  return s as AquariumState
}

const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz'

export function encodeBoard(tanks: number[], rowSums: number[], colSums: number[]): string {
  let out = ''
  for (const t of tanks) out += t >= 0 && t < BASE36.length ? BASE36[t]! : '0'
  return `${out}|${rowSums.join(',')}|${colSums.join(',')}`
}

export function decodeBoard(
  text: string,
  expected: number,
  w: number,
  h: number,
): { tanks: number[]; rowSums: number[]; colSums: number[] } | null {
  if (typeof text !== 'string') return null
  const parts = text.split('|')
  if (parts.length !== 3) return null
  const tankText = parts[0]!
  if (tankText.length !== expected) return null
  const tanks = new Array<number>(expected).fill(-1)
  for (let i = 0; i < expected; i++) {
    const v = BASE36.indexOf(tankText[i]!.toLowerCase())
    if (v < 0) return null
    tanks[i] = v
  }
  const parseNums = (s: string, len: number): number[] | null => {
    const out: number[] = []
    for (const part of s.split(',')) {
      const n = Number(part)
      if (!Number.isInteger(n) || n < 0) return null
      out.push(n)
    }
    return out.length === len ? out : null
  }
  const rowSums = parseNums(parts[1]!, h)
  const colSums = parseNums(parts[2]!, w)
  if (!rowSums || !colSums) return null
  return { tanks, rowSums, colSums }
}

export function encodeCells(cells: ArrayLike<number>): string {
  let out = ''
  for (let i = 0; i < cells.length; i++) out += String(cells[i]! | 0)
  return out
}

export function decodeCells(text: string, expected: number): number[] | null {
  if (typeof text !== 'string' || text.length !== expected) return null
  const out = new Array<number>(expected)
  for (let i = 0; i < expected; i++) {
    const ch = text[i]!
    if (ch === '0' || ch === '.') out[i] = EMPTY
    else if (ch === '1' || ch === 'F' || ch === 'f' || ch === '#') out[i] = FILLED
    else if (ch === '2' || ch === 'X' || ch === 'x' || ch === '-') out[i] = MARK
    else return null
  }
  return out
}

export function normalizeRegions(regions: number[]): number[] {
  const map = new Map<number, number>()
  let next = 0
  return regions.map((r) => {
    if (r < 0) return -1
    if (!map.has(r)) map.set(r, next++)
    return map.get(r)!
  })
}
