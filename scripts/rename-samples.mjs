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
