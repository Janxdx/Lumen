/* The cached form of a passage index has one job: come back the same.

   `packIndex` exists to make the index small enough to keep in IndexedDB,
   and every byte it saves is a byte that could have been the wrong one. So
   the test that matters is not that packing is compact — it is that a book
   found before packing is found identically after it, through the same
   `locatePassage` the app calls, on text that has been through the same
   corruption OCR inflicts. Anything less would pass while quietly returning
   you to the wrong chapter. */

import {
  buildPassageIndex,
  locatePassage,
  locusOf,
} from '../src/engine/passage.ts';
import {
  excerptAt,
  isCurrentPacked,
  packIndex,
  packedSize,
  unpackIndex,
} from '../src/engine/passageStore.ts';

let fails = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fails++; console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${name}`);
};
const ok = (name: string, cond: boolean, detail = '') => {
  if (!cond) { fails++; console.log(`FAIL ${name}${detail ? ': ' + detail : ''}`); }
  else console.log(`ok   ${name}`);
};

/* ── a book, built the same way passage-match builds one ───────────── */

const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const COMMON = 'the of and to a in that he it was for on with as his is at by she her not but they from this had have were all'.split(' ');
const RARE = ('wall stone ambiguous perimeter granite orchard mortar embankment quarry lichen ' +
  'shipyard telescope ansible syndicate corridor threshold anarres urras odonian ' +
  'partition boundary rockface freight scaffold gantry meridian solstice archive ' +
  'harvest silence courtyard doorway lantern verdict cartographer bequest').split(' ');

const prose = (rnd: () => number, n: number): string => {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const w = rnd() < 0.55 ? COMMON[(rnd() * COMMON.length) | 0] : RARE[(rnd() * RARE.length) | 0];
    out.push(w);
    if (i > 0 && i % 14 === 0) out.push('.');
  }
  return out.join(' ');
};

const rnd = mulberry32(42);
const chapters = [0, 1, 2, 3, 4].map((spineIndex) => ({
  spineIndex,
  text: prose(rnd, 3000),
}));

const index = buildPassageIndex(chapters);
const packed = packIndex(index);
const back = unpackIndex(packed);

/* ── the round trip ────────────────────────────────────────────────── */

ok('version tag recognised', isCurrentPacked(packed));
ok('an older row is refused', !isCurrentPacked({ ...packed, v: 0 }));
ok('a plain object is refused', !isCurrentPacked({ tokens: [1, 2, 3] }));

eq('tokens survive', Array.from(back.tokens), Array.from(index.tokens));
eq('chapter starts survive', back.spineStarts, index.spineStarts);
eq('spine mapping survives', back.spineOf, index.spineOf);
eq('every shingle survives', back.postings.size, index.postings.size);

let postingsMatch = true;
for (const [hash, list] of index.postings) {
  const got = back.postings.get(hash);
  if (!got || got.length !== list.length || got.some((v, i) => v !== list[i])) {
    postingsMatch = false;
    break;
  }
}
ok('every posting list survives, in order', postingsMatch);

/* Packing is meant to be canonical — same book in, same bytes out — so that
   two builds produce one cache row rather than two indistinguishable ones. */
const again = packIndex(buildPassageIndex(chapters));
eq('packing is deterministic', Array.from(again.keys), Array.from(packed.keys));
eq('packing is deterministic (values)', Array.from(again.values), Array.from(packed.values));

/* The whole point of the exercise: four bytes a number and no overhead. */
const numbers =
  packed.tokens.length + packed.keys.length + packed.starts.length + packed.values.length +
  packed.spineStarts.length + packed.spineOf.length;
eq('size is four bytes a number', packedSize(packed), numbers * 4);

/* ── searching the unpacked index ──────────────────────────────────── */

const words = chapters[3].text.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w));
const startInChapter = 900;
const passage = words.slice(startInChapter, startInChapter + 45).join(' ');

/* the same mangling passage-match tests against: dropped words, split
   words, and the classic rn/m confusion */
const corrupt = (text: string, seed: number): string => {
  const r = mulberry32(seed);
  return text
    .split(' ')
    .map((w) => {
      const d = r();
      if (d < 0.04) return '';
      if (d < 0.08) return w.replace(/m/g, 'rn');
      if (d < 0.12) return w.replace(/i/g, 'l');
      return w;
    })
    .filter(Boolean)
    .join(' ');
};

const direct = locatePassage(index, corrupt(passage, 7));
const cached = locatePassage(back, corrupt(passage, 7));

ok('a clean index finds the passage', direct !== null);
ok('the cached index finds it too', cached !== null);
eq('same position', cached?.tokenIndex, direct?.tokenIndex);
eq('same score', cached?.score, direct?.score);
eq('same confidence', cached?.confidence, direct?.confidence);
eq('same chapter', cached?.locus.spineIndex, 3);

/* A refusal has to survive packing as well as a match does — an index that
   became more willing to guess after a round trip would be worse than one
   that lost the match outright, because nothing would look wrong. */
eq('nonsense still refused', locatePassage(back, prose(mulberry32(999), 60)), null);
eq('too little still refused', locatePassage(back, passage.split(' ').slice(0, 12).join(' ')), null);

/* ── the sentence shown to the reader ──────────────────────────────── */

const at = locusOf(back, direct!.tokenIndex);
const around = excerptAt(chapters[3].text, at.wordIndex);
const shown = around.text.split(/\s+/);

ok('excerpt has both sides of the position', shown.length > 20, `${shown.length} words`);
eq('the marked word is the word we landed on', shown[around.markAt], words[at.wordIndex]);
ok('the marked word is inside the excerpt', around.markAt >= 0 && around.markAt < shown.length);

/* Edges: a position at the very start has nothing before it, and one past
   the end must be clamped rather than produce an empty quote. */
const atStart = excerptAt(chapters[0].text, 0);
eq('start of a chapter marks the first word', atStart.markAt, 0);
ok('start of a chapter still quotes forward', atStart.text.split(/\s+/).length > 1);

const past = excerptAt(chapters[0].text, 999_999);
ok('a position past the end is clamped', past.text.length > 0);

eq('no text at all is survivable', excerptAt('', 5), { text: '', markAt: 0 });

/* ── an empty book ─────────────────────────────────────────────────── */

const empty = packIndex(buildPassageIndex([{ spineIndex: 0, text: '' }]));
eq('an empty book packs', unpackIndex(empty).tokens.length, 0);
eq('and is refused rather than matched', locatePassage(unpackIndex(empty), passage), null);

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
