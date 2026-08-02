# Three pull requests, in order

A stack: each one is based on the previous, so merge them top to bottom and
GitHub retargets the next automatically. Push all three first, then open them.

```sh
git push -u origin feat/device-sync feat/passage-match feat/ratings
```

`feat/device-sync` is already on the remote at this commit, so that push is a
no-op for it — the branch just has no PR open yet.

---

## 1 · `feat/device-sync` → `main`

**Title:** Soluna Worker backend, device auth, and pace-aware stats

1 commit · 34 files · +5682 −456

Already pushed and unmerged since PR #1 went in — it needs a PR, not a rebase.

---

## 2 · `feat/passage-match` → `feat/device-sync`

**Title:** Find your place from a photograph of the page

1 commit · 4 files · +613 −5

### What this is

The device shelf asks you for a page number. This asks for nothing: point the
camera at the last page you read and the book is searched for that text. The
photograph is never stored — on iOS it never exists at all, because a focused
text field scans straight from the camera into the field, which means no OCR
dependency ships for the platform that matters most.

### How it works

Three stages, each cheap enough to leave the next with little to do.

**Fold** reduces a word to a form where OCR's mistakes and the publisher's
typography land in the same place — ligatures expand, accents and apostrophes
go, `rn` becomes `m`. The rules look like vandalism, and that is the point:
being wrong identically on both sides is worth more than being right on either.

**Seed** hashes overlapping five-word shingles and lets them vote on a diagonal
offset. All but a handful of regions are eliminated without comparing a word.

**Align** finishes with Smith–Waterman, because only alignment tolerates the
words OCR drops and invents. Local rather than global, so a running head and a
folio sit outside the aligned region for free.

### Why it is allowed to move your reading position

A wrong answer rewrites your place silently, so the match clears three gates:

| gate | value | catches |
|---|---|---|
| words recognised | ≥ 30 | a short quotation that reads convincingly in the wrong chapter |
| share aligned | ≥ 0.75 | text that isn't from this book |
| margin over runner-up | ≥ 1.3× | **repeated passages** — refrains, chapter openings, boilerplate |

The third is the one that matters. A threshold on the score alone will send you
confidently to the wrong one of two identical passages; the test
`ambiguous passage refused rather than guessed` is that case, and it returns
`null` rather than picking. Matches come back as `sure` (apply silently) or
`review` (confirm first).

Anchoring at the *end* of the alignment keeps the failure conservative: a
garbled foot of the page places you a few words short of where you are, never
somewhere you have not been.

### Cost

The index stores a hash per word rather than the word — equality is the only
question alignment asks, and four bytes answer it as well as a string for a
fifth of the memory. A novel indexes to a few megabytes and structured-clones
straight into IndexedDB. A lookup runs in 0.1 ms over 15k tokens.

### Tests

33 assertions in `tests/passage-match.test.mts`, including OCR damage modelled
as it actually occurs: 5% dropped words, mid-word splits, `m`→`rn`, `o`→`0`,
plus a running head and a page number.

### Note for review

`plainText` moves out of `countWords` into `tokenize.ts` so that counting,
indexing and rendering strip markup through one function. The word indices this
returns are the indices the pacer highlights, and they only agree if the split
does.

---

## 3 · `feat/ratings` → `feat/passage-match`

**Title:** The Shelf: rate a book on five axes, and read your taste back

8 commits · 28 files · +3359 −31

Five-axis rating model with a bookbinding-cloth mood palette, Dexie v4 storage,
sync, the Shelf tab and rating editor, and a taste card that exports as an
image.

### History note

These commits were rebased. The original first commit had four unrelated files
swept into it by a concurrent session; they now live in PR 2 where they belong,
and no rating commit touches `passage.ts` or `tokenize.ts`. The resulting tree
is byte-identical to the tangled original apart from `package.json`, which now
runs both test suites. Pre-rebase state is kept at
`backup/scan-to-sync-tangled` and can be deleted once this merges.
