# Sample Library Renaming — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all original third-party sample names (e.g. `Eq Boom Eq Sub001 Smokers2 Dm`) with branded EG names (`EG Sub Kick 1`) in `src/audio/SampleLibrary.ts`, keeping file paths unchanged.

**Architecture:** Script-based transformation — a temporary Node.js script reads `SampleLibrary.ts` as text, groups entries by `category`, assigns sequential EG names in existing array order, rewrites `id`, `name`, and `pack` fields, then writes the file back. No schema changes, no migration risk.

**Tech Stack:** Node.js ESM script (`.mjs`), plain string/regex transforms on TypeScript source.

---

## Files

| File | Change |
|---|---|
| `src/audio/SampleLibrary.ts` | Rewrite `id`, `name`, `pack` for all ~1715 entries |
| `scripts/rename-samples.mjs` | Temporary transformation script — deleted after use |

---

## Task 1: Write the transformation script

**File:** `scripts/rename-samples.mjs` (create new)

- [ ] **Step 1: Create `scripts/` directory if it doesn't exist and write the script**

Create `/Users/frankkrumsdorf/Desktop/Claude Code Landingpage Elastic Field/Elastic Drum/scripts/rename-samples.mjs` with this content:

```javascript
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TARGET = join(__dirname, '../src/audio/SampleLibrary.ts');

// Category label map: folder name → display label + slug
const CATEGORY_MAP = {
  'boom-kicks':   { label: 'Sub Kick',  slug: 'sub-kick'  },
  'kicks':        { label: 'Kick',      slug: 'kick'      },
  'snares':       { label: 'Snare',     slug: 'snare'     },
  'claps':        { label: 'Clap',      slug: 'clap'      },
  'hats-closed':  { label: 'HH Closed', slug: 'hh-closed' },
  'hats-open':    { label: 'HH Open',   slug: 'hh-open'   },
  'hats':         { label: 'Hat',       slug: 'hat'       },
  'cymbals':      { label: 'Cymbal',    slug: 'cymbal'    },
  'toms':         { label: 'Tom',       slug: 'tom'       },
  'percussions':  { label: 'Perc',      slug: 'perc'      },
  'shakers':      { label: 'Shaker',    slug: 'shaker'    },
  'rims':         { label: 'Rim',       slug: 'rim'       },
  'snaps':        { label: 'Snap',      slug: 'snap'      },
  'sfx':          { label: 'SFX',       slug: 'sfx'       },
  'oneshots':     { label: 'One Shot',  slug: 'one-shot'  },
  'chords':       { label: 'Chord',     slug: 'chord'     },
};

let src = readFileSync(TARGET, 'utf8');

// Track counters per category
const counters = {};

// Match each sample object entry — captures id, name, optional key, path, category, pack
// Pattern: { id: "...", name: "...", [key: "...",] path: "...", category: "...", pack: "..." }
const ENTRY_RE = /\{ id: "([^"]*)", name: "([^"]*)",(?: key: "([^"]*)",)? path: "([^"]*)", category: "([^"]*)", pack: "([^"]*)" \}/g;

let replacedCount = 0;

src = src.replace(ENTRY_RE, (match, _id, _name, key, path, category, _pack) => {
  const cat = CATEGORY_MAP[category];
  if (!cat) {
    console.warn(`  ⚠ Unknown category: "${category}" — entry left unchanged`);
    return match;
  }

  counters[category] = (counters[category] || 0) + 1;
  const n = counters[category];
  const newId   = `eg-${cat.slug}-${String(n).padStart(3, '0')}`;
  const newName = `EG ${cat.label} ${n}`;
  const newPack = 'EG Library';

  replacedCount++;

  if (key !== undefined) {
    return `{ id: "${newId}", name: "${newName}", key: "${key}", path: "${path}", category: "${category}", pack: "${newPack}" }`;
  }
  return `{ id: "${newId}", name: "${newName}", path: "${path}", category: "${category}", pack: "${newPack}" }`;
});

writeFileSync(TARGET, src, 'utf8');

console.log(`\n✅ Done. Replaced ${replacedCount} entries.\n`);
console.log('Counts per category:');
for (const [cat, count] of Object.entries(counters).sort()) {
  const meta = CATEGORY_MAP[cat];
  console.log(`  ${cat.padEnd(14)} → ${String(count).padStart(4)} entries  (eg-${meta.slug}-001 … eg-${meta.slug}-${String(count).padStart(3, '0')})`);
}
```

- [ ] **Step 2: Verify the script file exists**

```bash
ls -la "/Users/frankkrumsdorf/Desktop/Claude Code Landingpage Elastic Field/Elastic Drum/scripts/rename-samples.mjs"
```

Expected: file listed, ~2.4KB.

- [ ] **Step 3: Commit the script**

```bash
cd "/Users/frankkrumsdorf/Desktop/Claude Code Landingpage Elastic Field/Elastic Drum"
git add scripts/rename-samples.mjs
git commit -m "chore: add sample renaming script (temporary)"
```

---

## Task 2: Run the script and verify output

**File:** `src/audio/SampleLibrary.ts`

- [ ] **Step 1: Back up the original file**

```bash
cp "/Users/frankkrumsdorf/Desktop/Claude Code Landingpage Elastic Field/Elastic Drum/src/audio/SampleLibrary.ts" \
   "/Users/frankkrumsdorf/Desktop/Claude Code Landingpage Elastic Field/Elastic Drum/src/audio/SampleLibrary.ts.bak"
```

- [ ] **Step 2: Run the transformation script**

```bash
cd "/Users/frankkrumsdorf/Desktop/Claude Code Landingpage Elastic Field/Elastic Drum"
node scripts/rename-samples.mjs
```

Expected output (exact numbers may vary slightly):
```
✅ Done. Replaced 1715 entries.

Counts per category:
  boom-kicks     →   XX entries  (eg-sub-kick-001 … eg-sub-kick-0XX)
  chords         →   XX entries  (eg-chord-001 … eg-chord-0XX)
  claps          →   XX entries  ...
  cymbals        →   XX entries  ...
  hats           →   XX entries  ...
  hats-closed    →   XX entries  ...
  hats-open      →   XX entries  ...
  kicks          →  XXX entries  ...
  oneshots       →   XX entries  ...
  percussions    →   XX entries  ...
  rims           →   XX entries  ...
  sfx            →   XX entries  ...
  shakers        →   XX entries  ...
  snaps          →   XX entries  ...
  snares         →  XXX entries  ...
  toms           →   XX entries  ...
```

No `⚠ Unknown category` warnings should appear.

- [ ] **Step 3: Spot-check the transformed file**

Run these grep commands to verify:

```bash
cd "/Users/frankkrumsdorf/Desktop/Claude Code Landingpage Elastic Field/Elastic Drum"

# First 3 boom-kicks entries should now be eg-sub-kick-001/002/003
grep -m 5 '"boom-kicks"' src/audio/SampleLibrary.ts

# A mid-range kick entry (around #100)
grep -m 1 'eg-kick-100' src/audio/SampleLibrary.ts

# Verify no old-style ids remain (eq-boom, eq-snare, epi-, smokers)
grep -c 'pack: "boom-kicks"\|pack: "kicks"\|pack: "snares"' src/audio/SampleLibrary.ts

# Should be 0 — all packs now "EG Library"
echo "Old pack refs remaining (should be 0 per category pack):"
grep -c '"pack": "boom-kicks"' src/audio/SampleLibrary.ts || true

# Verify EG Library is pervasive
grep -c '"EG Library"' src/audio/SampleLibrary.ts
```

Expected:
- First 5 boom-kicks lines show `id: "eg-sub-kick-001"` … `"eg-sub-kick-00X"`, `name: "EG Sub Kick 1"` … `"EG Sub Kick X"`
- `grep -c '"EG Library"'` returns ~1715
- Old pack strings like `"boom-kicks"` appear only in `category:` and `path:` fields, never in `pack:` field

- [ ] **Step 4: Verify file paths and keys are unchanged**

```bash
cd "/Users/frankkrumsdorf/Desktop/Claude Code Landingpage Elastic Field/Elastic Drum"

# Paths should still reference original filenames
grep -m 3 'eq-boom-eq-sub001' src/audio/SampleLibrary.ts
# Expected: path field still contains the original filename

# Key annotations preserved
grep -m 5 'key: "Dm"' src/audio/SampleLibrary.ts
# Expected: key field present and unchanged
```

- [ ] **Step 5: Remove backup and delete the script**

```bash
cd "/Users/frankkrumsdorf/Desktop/Claude Code Landingpage Elastic Field/Elastic Drum"
rm src/audio/SampleLibrary.ts.bak
rm scripts/rename-samples.mjs
rmdir scripts 2>/dev/null || true  # remove dir only if empty
```

- [ ] **Step 6: Commit the renamed library**

```bash
cd "/Users/frankkrumsdorf/Desktop/Claude Code Landingpage Elastic Field/Elastic Drum"
git add src/audio/SampleLibrary.ts
git rm --cached scripts/rename-samples.mjs 2>/dev/null || git add -u scripts/
git commit -m "feat: rename sample library — EG branded names (EG Kick 1, EG Snare 1, etc.)"
```

---

## Task 3: Build verification

**Confirm no TypeScript errors were introduced.**

- [ ] **Step 1: Run TypeScript build**

```bash
cd "/Users/frankkrumsdorf/Desktop/Claude Code Landingpage Elastic Field/Elastic Drum"
npm run build
```

Expected: build completes with 0 errors. Warnings about bundle size are acceptable.

- [ ] **Step 2: If build fails, check for regex edge cases**

Common causes:
- Entry with an extra field not matched by the regex → check with `grep -n 'pack: "boom-kicks"' src/audio/SampleLibrary.ts` to find any unreplaced entries
- Entry with a different field order → inspect the raw line and adjust `ENTRY_RE` in the script, then re-run from Task 2 Step 1 (restore backup first: `cp src/audio/SampleLibrary.ts.bak src/audio/SampleLibrary.ts`)

- [ ] **Step 3: Final commit if any build fixes were needed**

If no fixes were needed, skip this step.

```bash
cd "/Users/frankkrumsdorf/Desktop/Claude Code Landingpage Elastic Field/Elastic Drum"
git add src/audio/SampleLibrary.ts
git commit -m "fix: sample library rename — fix edge case entries"
```

---

## Verification Checklist

After all tasks:

1. Open app in browser → Kit Browser → load any factory kit
2. Pad tooltip / sample name shows "EG Kick 1", "EG Snare 1", etc. — not "eq-kick-..." or "Eq Kick..."
3. Sample Library panel lists "EG Sub Kick 1", "EG Kick 1", "EG Snare 1" in order
4. Existing saved patterns still load and play correctly (file paths unchanged)
5. `npm run build` passes with no TypeScript errors
6. No "smokers2", "epi", "eq-boom", "eq-snare" strings appear in the UI
