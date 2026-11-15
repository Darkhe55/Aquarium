/**
 * 水箱 —— SVG 渲染与命中
 */

import type { BoardMetrics, GameState, Puzzle, ValidationResult } from '../core/types'
import {
  cellAtPoint,
  cellCenter,
  regionBoundarySegments,
  regionFill,
  squareMetrics,
} from '../core/board'
import {
  asAquaPuzzle,
  asAquaState,
  EMPTY,
  FILLED,
  MARK,
  type AquariumResult,
} from './types'

export function metricsFor(puzzle: Puzzle): BoardMetrics {
  return squareMetrics(puzzle.width, puzzle.height, {
    cell: 46,
    padLeft: 62,
    padTop: 62,
    padRight: 26,
    padBottom: 26,
    targetKind: 'cell',
  })
}

export function renderBoard(
  puzzle: Puzzle,
  state: GameState,
  result: ValidationResult,
  _colorGrid?: unknown,
): string {
  const m = metricsFor(puzzle)
  const p = asAquaPuzzle(puzzle)
  const s = asAquaState(state)
  const r = result as AquariumResult
  const w = puzzle.width
  const h = puzzle.height
  const tanks = p.tanks ?? []
  const rowSums = p.rowSums ?? []
  const colSums = p.colSums ?? []
  const bad = new Set<number>(r.badCells ?? [])
  const badRows = new Set<number>()
  const badCols = new Set<number>()
  for (const issue of r.sumIssues ?? []) {
    if (issue.orientation === 'row') badRows.add(issue.index)
    else badCols.add(issue.index)
  }

  const cell = m.cell
  const originX = m.originX ?? m.pad
  const originY = m.originY ?? m.pad
  const gap = Math.max(1, cell * 0.03)
  const inner = cell - gap
  const radius = cell * 0.1
  const parts: string[] = []

  parts.push(
    `<rect class="aq-board-bg" x="${originX - 10}" y="${originY - 10}" width="${w * cell + 20}" height="${h * cell + 20}" rx="${(cell * 0.2).toFixed(2)}" />`,
  )

  for (let i = 0; i < w * h; i++) {
    const x = originX + (i % w) * cell + gap / 2
    const y = originY + Math.floor(i / w) * cell + gap / 2
    const v = s.cells[i] ?? EMPTY
    const tank = tanks[i] ?? -1

    let cls = 'aq-cell'
    if (v === FILLED) cls += ' filled'
    else if (v === MARK) cls += ' mark'
    else cls += ' empty'
    if (bad.has(i)) cls += ' bad'

    const fill = v === FILLED ? '#2f6f8f' : regionFill(tank)
    let content = `<rect class="${cls}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${inner.toFixed(2)}" height="${inner.toFixed(2)}" rx="${radius.toFixed(2)}" fill="${fill}" />`
    if (v === MARK) {
      content += `<text class="aq-x" x="${(x + inner / 2).toFixed(2)}" y="${(y + inner / 2 + cell * 0.02).toFixed(2)}" style="font-size:${(cell * 0.34).toFixed(2)}px">×</text>`
    }
    if (bad.has(i)) {
      content += `<rect class="aq-error" x="${(x + 1.1).toFixed(2)}" y="${(y + 1.1).toFixed(2)}" width="${(inner - 2.2).toFixed(2)}" height="${(inner - 2.2).toFixed(2)}" rx="${(radius * 0.8).toFixed(2)}" />`
    }
    parts.push(`<g data-index="${i}">${content}</g>`)
  }

  const segs = regionBoundarySegments(m, tanks)
  parts.push(
    `<g class="aq-tank-lines">${segs
      .map(
        (seg) =>
          `<line x1="${seg.x1.toFixed(2)}" y1="${seg.y1.toFixed(2)}" x2="${seg.x2.toFixed(2)}" y2="${seg.y2.toFixed(2)}" />`,
      )
      .join('')}</g>`,
  )

  const labels: string[] = []
  for (let y = 0; y < h; y++) {
    const c = cellCenter(m, y * w)
    labels.push(
      `<text class="aq-sum${badRows.has(y) ? ' issue' : ''}" x="${(c.x - cell / 2 - 10).toFixed(2)}" y="${c.y.toFixed(2)}" style="font-size:${(cell * 0.32).toFixed(2)}px">${rowSums[y] ?? 0}</text>`,
    )
  }
  for (let x = 0; x < w; x++) {
    const c = cellCenter(m, x)
    labels.push(
      `<text class="aq-sum col${badCols.has(x) ? ' issue' : ''}" x="${c.x.toFixed(2)}" y="${(c.y - cell / 2 - 12).toFixed(2)}" style="font-size:${(cell * 0.32).toFixed(2)}px">${colSums[x] ?? 0}</text>`,
    )
  }
  parts.push(`<g class="aq-sums">${labels.join('')}</g>`)

  for (let i = 0; i < w * h; i++) {
    const x = originX + (i % w) * cell
    const y = originY + Math.floor(i / w) * cell
    parts.push(
      `<rect class="cell-hit" data-index="${i}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}" />`,
    )
  }

  return `<svg class="board-svg aq-board" viewBox="0 0 ${m.svgWidth} ${m.svgHeight}" width="${m.svgWidth}" height="${m.svgHeight}" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`
}

export function hitTest(
  m: BoardMetrics,
  _puzzle: Puzzle,
  x: number,
  y: number,
): { index: number } | null {
  const index = cellAtPoint(m, x, y)
  return index == null ? null : { index }
}
