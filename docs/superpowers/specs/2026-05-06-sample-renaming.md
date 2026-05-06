# Sample Library Renaming — Design Spec

## Goal

Replace all original third-party sample names (e.g. `Eq Boom Eq Sub001 Smokers2 Dm`) with branded Elastic Groove names (`EG Sub Kick 1`) in `SampleLibrary.ts`. File paths on disk are unchanged — zero migration risk for existing saved patterns.

## Key Decision: Display Names Only, Files Stay

**File paths on disk are NOT renamed.** `factoryKits.ts` is NOT changed. Saved user patterns in IndexedDB reference file paths — those stay stable.

Only `src/audio/SampleLibrary.ts` changes:
- `name` field: human-readable display name shown in the UI → becomes `EG [Category] [N]`
- `id` field: internal identifier → becomes `eg-[category]-[NNN]`
- `pack` field: currently "boom-kicks", "kicks" etc. → becomes `"EG Library"` for all

The `path`, `key`, and `category` fields are unchanged.

---

## Naming Convention

Format: `EG [CategoryLabel] [N]`

| Folder | Category Label | Example |
|---|---|---|
| `boom-kicks` | Sub Kick | EG Sub Kick 1 |
| `kicks` | Kick | EG Kick 1 |
| `snares` | Snare | EG Snare 1 |
| `claps` | Clap | EG Clap 1 |
| `hats-closed` | HH Closed | EG HH Closed 1 |
| `hats-open` | HH Open | EG HH Open 1 |
| `hats` | Hat | EG Hat 1 |
| `cymbals` | Cymbal | EG Cymbal 1 |
| `toms` | Tom | EG Tom 1 |
| `percussions` | Perc | EG Perc 1 |
| `shakers` | Shaker | EG Shaker 1 |
| `rims` | Rim | EG Rim 1 |
| `snaps` | Snap | EG Snap 1 |
| `sfx` | SFX | EG SFX 1 |
| `oneshots` | One Shot | EG One Shot 1 |
| `chords` | Chord | EG Chord 1 |

Numbers are sequential starting at 1 within each category, ordered by the existing array order in `SampleLibrary.ts` (which matches filesystem order).

The `key` field (musical key annotation, e.g. "Dm", "Cm") is preserved unchanged where it exists.

---

## ID Convention

Format: `eg-[category-slug]-[NNN]` (zero-padded to 3 digits)

Examples:
- `eg-sub-kick-001`, `eg-sub-kick-002`, ...
- `eg-kick-001`, `eg-kick-427`
- `eg-snare-001`, `eg-snare-326`

---

## Before / After Example

```typescript
// BEFORE
{ id: "eq-boom-eq-sub001-smokers2-dm", name: "Eq Boom Eq Sub001 Smokers2 Dm - Dm", key: "Dm", path: "/samples/library/boom-kicks/eq-boom-eq-sub001-smokers2-dm.ogg", category: "boom-kicks", pack: "boom-kicks" },

// AFTER
{ id: "eg-sub-kick-001", name: "EG Sub Kick 1", key: "Dm", path: "/samples/library/boom-kicks/eq-boom-eq-sub001-smokers2-dm.ogg", category: "boom-kicks", pack: "EG Library" },
```

---

## Implementation Approach

`SampleLibrary.ts` is 2386 lines and is auto-generated in structure (one object per sample). The cleanest implementation is a **script-based transformation**:

1. Write a Node.js script `scripts/rename-samples.mjs` that:
   - Reads `src/audio/SampleLibrary.ts` as text
   - Groups existing entries by `category`
   - Within each category, assigns sequential EG names in existing order
   - Rewrites `id`, `name`, and `pack` fields
   - Writes the transformed file back

2. Run the script: `node scripts/rename-samples.mjs`

3. Verify output: spot-check 5-10 entries per category in the resulting file

4. Run `npm run build` to confirm no TypeScript errors

5. Delete the script after use

---

## File

| File | Change |
|---|---|
| `src/audio/SampleLibrary.ts` | Rewrite `id`, `name`, `pack` for all ~1715 entries |
| `scripts/rename-samples.mjs` | Temporary transformation script — deleted after use |

No other files change. `factoryKits.ts`, stored patterns, and all file paths are untouched.

---

## Verification

1. Open app in browser → Kit Browser → load any factory kit
2. Pad shows sample name in tooltip/browser → displays "EG Kick 1" etc. (not "eq-kick-...")
3. Sample Library panel lists "EG Sub Kick 1", "EG Kick 1", "EG Snare 1"... in order
4. Existing saved patterns still load and play correctly (file paths unchanged)
5. `npm run build` passes with no TypeScript errors
6. No "smokers2", "epi", "eq-boom", "eq-snare" strings appear in the UI
