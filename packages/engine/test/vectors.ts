/**
 * Known-answer vectors for fairness algorithm pump:v1. They were generated with Node's built-in
 * `node:crypto` HMAC — a different implementation from the engine's @noble/hashes — so the
 * engine reproducing them is an independent check. The same vectors are published in
 * docs/FAIRNESS.md.
 */
export interface TestVector {
  readonly name: string;
  readonly serverSeedHex: string;
  readonly commitment: string;
  readonly roundId: string;
  readonly nonce: number;
  readonly clientSeed: string;
  readonly samples: readonly number[];
  readonly attempts: readonly number[];
  readonly popPoint: number | null;
}

const ones = (count: number): number[] => Array.from({ length: count }, () => 1);

export const TEST_VECTORS: readonly TestVector[] = [
  {
    name: 'A — pops on pump 3',
    serverSeedHex: '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
    commitment: '630dcd2966c4336691125448bbb25b4ff412a49c732db2c8abc1b8581bd710dd',
    roundId: '00000000-0000-4000-8000-000000000001',
    nonce: 1,
    clientSeed: 'player-seed',
    samples: [9154, 8315, 377],
    attempts: ones(3),
    popPoint: 3,
  },
  {
    name: 'B — survives all 25 pumps',
    serverSeedHex: '3e82057bcf2aa2dc03e2411ea961f9aa9156d1875f4635fc3075a8cdca96334a',
    commitment: '56a71c613c06ec8cccdc2d97e7b0eacdc4f077063d52b9d4db1d465ddebb4112',
    roundId: '00000000-0000-4000-8000-00000000000b',
    nonce: 925,
    clientSeed: 'ladder-top',
    // prettier-ignore
    samples: [
      5120, 1222, 3917, 9595, 7312, 7627, 3908, 9831, 6527, 8098, 9660, 5392, 4521,
      6915, 7222, 8911, 7268, 2927, 5464, 3763, 9112, 6865, 7549, 6528, 9392,
    ],
    attempts: ones(25),
    popPoint: null,
  },
  {
    name: 'C — first draw rejected (u = 4294960657 ≥ 4294960000)',
    serverSeedHex: '6f6781fe0d80e49d4e64392c9933ecdecfdeb4b65bf716b635618c56aec2ebd4',
    commitment: 'a6acb2ba26ffe7f3200d146f94ba6faff3edf6770baec725ef8b0b841a0aac4b',
    roundId: '00000000-0000-4000-8000-00000000000c',
    nonce: 1,
    clientSeed: 'reject-469868',
    samples: [4860, 3782, 9503, 874],
    attempts: [2, 1, 1, 1],
    popPoint: 4,
  },
];
