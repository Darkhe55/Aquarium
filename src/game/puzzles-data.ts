/* 自动生成，勿手改。运行 npm run gen 重新生成。 */
export interface RawPuzzle {
  id: string
  name: string
  width: number
  height: number
  difficulty: 'easy' | 'medium' | 'hard' | 'custom'
  series: string
  /** 题面编码串（格式由 src/game/puzzles.ts 解析） */
  board: string
  /** 参考解编码串（没有则留空） */
  solution?: string
}

export const RAW_PUZZLES: RawPuzzle[] = [
  { id: "aquarium-6x6-i4fuo1", name: "初识水箱", width: 6, height: 6, difficulty: 'easy', series: "入门", board: "111111021111022222032222333332333333|0,1,6,5,1,0|2,2,2,2,2,3", solution: "222222212222111111121111222221222222" },
  { id: "aquarium-7x7-i4fuo2", name: "七箱水影", width: 7, height: 7, difficulty: 'easy', series: "入门", board: "1111444222114422211443222114333220033320003333000|0,3,3,4,5,4,4|6,6,6,4,1,0,0", solution: "2222222111222211122221111222111112211112221111222" },
  { id: "aquarium-8x8-i4fuo3", name: "水位回廊", width: 8, height: 8, difficulty: 'medium', series: "进阶", board: "0222223302222333011144331114443311444333114544351145555511555555|0,0,0,0,0,3,3,2|3,3,1,0,0,0,1,0", solution: "2222222222222222222222222222222222222222112222121112222211222222" },
  { id: "aquarium-8x8-i4fuo4", name: "注水迷阵", width: 8, height: 8, difficulty: 'medium', series: "进阶", board: "6655555565555445666354456333344463334414220441112200411122001111|0,0,2,0,1,6,8,8|3,3,3,2,3,3,4,4", solution: "2222222222222222222212212222222222222212111221111111111111111111" },
  { id: "aquarium-8x8-i4fuo5", name: "满溢之箱", width: 8, height: 8, difficulty: 'hard', series: "挑战", board: "5555711155577111477731334444333344463336044666660000226200000222|0,6,4,4,6,3,4,5|5,5,5,2,4,4,4,3", solution: "2222222211122111222211112222111111121112111222221111222211111222" },
  { id: "aquarium-8x8-i4fuo6", name: "水箱终局", width: 8, height: 8, difficulty: 'hard', series: "挑战", board: "0088888806222333662255536625555366211153662211147677714477777114|0,3,5,5,2,6,7,8|2,1,7,6,6,5,6,3", solution: "2222222222111222221111122211111222122212221111111211111111111111" },
]
