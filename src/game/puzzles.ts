/**
 * 水箱 —— 题库加载
 */

import { RAW_PUZZLES } from './puzzles-data'
import {
  asAquaPuzzle,
  decodeBoard,
  decodeCells,
  EMPTY,
  type AquariumPuzzle,
  type AquariumState,
} from './types'

export const builtinPuzzles: AquariumPuzzle[] = []
const solutions = new Map<string, number[]>()

for (const raw of RAW_PUZZLES) {
  const size = raw.width * raw.height
  const decoded = decodeBoard(raw.board, size, raw.width, raw.height)
  if (!decoded) {
    console.warn(`[水箱] 题面解码失败：${raw.id}`)
    continue
  }
  const puzzle: AquariumPuzzle = {
    id: raw.id,
    name: raw.name,
    width: raw.width,
    height: raw.height,
    difficulty: raw.difficulty,
    tanks: decoded.tanks,
    rowSums: decoded.rowSums,
    colSums: decoded.colSums,
  }
  builtinPuzzles.push(puzzle)
  if (raw.solution) {
    const solution = decodeCells(raw.solution, size)
    if (solution) {
      puzzle.solution = solution
      solutions.set(raw.id, solution)
    }
  }
}

export function getReferenceSolution(id: string): AquariumState | null {
  const cells = solutions.get(id)
  if (!cells) return null
  const puzzle = builtinPuzzles.find((p) => p.id === id)
  if (!puzzle) return null
  return {
    puzzleId: puzzle.id,
    width: puzzle.width,
    height: puzzle.height,
    cells: cells.slice(),
    givens: new Array<number>(puzzle.width * puzzle.height).fill(EMPTY),
  }
}

export function puzzleById(id: string): AquariumPuzzle | undefined {
  return builtinPuzzles.find((p) => p.id === id)
}

export function referenceFor(puzzle: AquariumPuzzle): number[] | null {
  return asAquaPuzzle(puzzle).solution ?? solutions.get(puzzle.id) ?? null
}
