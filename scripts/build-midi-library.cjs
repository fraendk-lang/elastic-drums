#!/usr/bin/env node
/**
 * build-midi-library.js
 *
 * Scans 5 Elastic Sound Pack MIDI folders, parses filenames,
 * copies .mid files to public/midi-library/, and writes index.json.
 *
 * Run: node scripts/build-midi-library.js
 */

const fs = require("fs");
const path = require("path");

// ─── Pack Sources ──────────────────────────────────────────────────────────────

const PACKS_BASE = path.resolve(
  __dirname,
  "../../Elastic Sound Packs"
);

const PACKS = [
  {
    id: "AMB",
    name: "Atemarchitektur",
    color: "#8B7EC8",
    midiDir: path.join(PACKS_BASE, "four-pack-pipeline/packs/01_AMB_Atemarchitektur/MIDI"),
  },
  {
    id: "SJZ",
    name: "Blue Glass After Hours",
    color: "#4A9EBA",
    midiDir: path.join(PACKS_BASE, "four-pack-pipeline/packs/02_SJZ_BlueGlassAfterHours/MIDI"),
  },
  {
    id: "ELEC",
    name: "Betonliturgie",
    color: "#C0392B",
    midiDir: path.join(PACKS_BASE, "four-pack-pipeline/packs/03_ELEC_Betonliturgie/MIDI"),
  },
  {
    id: "DH",
    name: "Velvet Utility",
    color: "#D4A017",
    midiDir: path.join(PACKS_BASE, "four-pack-pipeline/packs/04_DH_VelvetUtility/MIDI"),
  },
  {
    id: "TRP",
    name: "HarbourGlow",
    color: "#2EC4B6",
    midiDir: path.join(PACKS_BASE, "Trip Hop Sample Pack/HarbourGlow/MIDI"),
  },
];

// ─── Category Map ──────────────────────────────────────────────────────────────

// Normalized category ID → display name
const CAT_DISPLAY = {
  chords: "Chords",
  bass: "Bass",
  leads: "Leads",
  keys: "Keys",
  arps: "Arps",
  pads: "Pads",
  drums: "Drums",
  oneshots: "One Shots",
};

// Folder name fragment → normalized category (lowercase comparison)
const FOLDER_TO_CAT = {
  chords: "chords",
  chord: "chords",
  bass: "bass",
  leads: "leads",
  lead: "leads",
  keys: "keys",
  key: "keys",
  arps: "arps",
  arp: "arps",
  pads: "pads",
  pad: "pads",
  drums: "drums",
  drum: "drums",
  oneshots: "oneshots",
  one_shots: "oneshots",
};

// Categories to skip
const SKIP_FOLDERS = ["fx_cc", "arrangements", "arrangement", "fx"];

// ─── Filename Parsers ──────────────────────────────────────────────────────────

/**
 * Parse AMB/SJZ/ELEC/DH style filenames:
 * {PACK}_{CAT}_{INSTRUMENT_NAME}_{Key}-{Scale}_{BPM}_SW{swing}_BAR{bars}_V{var}_PC{prog}.mid
 * e.g. AMB_PADS_BREATH_DRIFT_C-AEO_068_SW50_BAR32_V01_PC01.mid
 *
 * Also handles DH drums:
 * DH_DRUMS_BREAKDOWN_GROOVE_AM-AEO_124_SW56_BAR08_V01_PC00.mid
 */
function parseFourPackFilename(stem) {
  // Key-Scale pattern: optional-letter(s) + optional-flat/sharp + dash + scale-abbr
  // Matches: C-AEO, BB-DOR, AM-AEO, CM-AEO etc.
  // Key format: A-G, optional flat(B/BB) or sharp(S/SS/#/##), optional minor(M/m)
  // e.g. C, AM, BB, BBM, FSM (F#m), CSM (C#m), CM, DM
  const m = stem.match(
    /^([A-Z]+)_([A-Z_]+)_(.+?)_([A-G](?:SS?|BB?|##?|S|B|#)?(?:M|m)?)-([A-Z]+)_(\d{3})_SW(\d{2,3})_BAR(\d{2,3})_V(\d{2})_PC(\d{2})$/i
  );
  if (!m) return null;

  const [, pack, catRaw, instrument, keyNote, scale, bpmStr, swStr, barsStr, varStr, progStr] = m;

  // Normalize: FS→F#, CS→C# etc.; trailing B→b only if not whole key
  const normalizedKey = keyNote
    .replace(/([A-G])SS/i, "$1##")
    .replace(/([A-G])S/i, "$1#")
    .replace(/([A-G])BB/i, "$1bb")
    .replace(/([A-G])B(?!B)/i, (m2, note) => note + "b");

  return {
    pack,
    catRaw: catRaw.replace(/_/g, " "),
    instrument: instrument.replace(/_/g, " "),
    key: normalizedKey,
    scale: scale.toUpperCase(),
    bpm: parseInt(bpmStr, 10),
    swing: parseInt(swStr, 10),
    bars: parseInt(barsStr, 10),
    variation: parseInt(varStr, 10),
    program: parseInt(progStr, 10),
  };
}

/**
 * Parse TRP (HarbourGlow) style filenames:
 * {PACK}_{CAT}_{INSTRUMENT}_{Key}-{Scale}_{BPM}_SW{swing}_{bars}B_V{var}_PC{prog}.mid
 * e.g. TRP_CHRD_PIANOCP_Am-AEO_90_SW54_08B_V03_PC05.mid
 */
function parseTrpFilename(stem) {
  const m = stem.match(
    /^([A-Z]+)_([A-Z_]+)_(.+?)_([A-G](?:SS?|BB?|##?|S|B|#)?(?:m|M)?)-([A-Z]+)_(\d+)_SW(\d{2,3})_(\d{2,3})B_V(\d{2})_PC(\d{2})$/i
  );
  if (!m) return null;

  const [, pack, catRaw, instrument, keyNote, scale, bpmStr, swStr, barsStr, varStr, progStr] = m;

  const normalizedKey = keyNote
    .replace(/([A-G])SS/i, "$1##")
    .replace(/([A-G])S/i, "$1#")
    .replace(/([A-G])BB/i, "$1bb")
    .replace(/([A-G])B(?!B)/i, (m2, note) => note + "b");

  return {
    pack,
    catRaw: catRaw.replace(/_/g, " "),
    instrument: instrument.replace(/_/g, " "),
    key: normalizedKey,
    scale: scale.toUpperCase(),
    bpm: parseInt(bpmStr, 10),
    swing: parseInt(swStr, 10),
    bars: parseInt(barsStr, 10),
    variation: parseInt(varStr, 10),
    program: parseInt(progStr, 10),
  };
}

function parseFilename(stem, packId) {
  if (packId === "TRP") {
    return parseTrpFilename(stem) ?? parseFourPackFilename(stem);
  }
  return parseFourPackFilename(stem) ?? parseTrpFilename(stem);
}

// ─── Category Normalization ────────────────────────────────────────────────────

function normalizeFolderName(folderName) {
  // Strip leading number (01_, 02_, etc.)
  const stripped = folderName.replace(/^\d+_/, "").toLowerCase();
  for (const [key, val] of Object.entries(FOLDER_TO_CAT)) {
    if (stripped.includes(key)) return val;
  }
  return null;
}

function shouldSkipFolder(folderName) {
  const stripped = folderName.replace(/^\d+_/, "").toLowerCase();
  return SKIP_FOLDERS.some((s) => stripped.includes(s));
}

// ─── Output ───────────────────────────────────────────────────────────────────

const OUT_DIR = path.resolve(__dirname, "../public/midi-library");
const INDEX_PATH = path.join(OUT_DIR, "index.json");

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const index = {
    version: 1,
    generatedAt: new Date().toISOString(),
    packs: [],
    patterns: [],
  };

  let totalCopied = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (const pack of PACKS) {
    if (!fs.existsSync(pack.midiDir)) {
      console.warn(`⚠  Pack dir not found: ${pack.midiDir}`);
      continue;
    }

    const packEntry = {
      id: pack.id,
      name: pack.name,
      color: pack.color,
      categories: [],
      patternCount: 0,
    };

    const categoryEntries = fs.readdirSync(pack.midiDir).filter((f) => {
      const full = path.join(pack.midiDir, f);
      return fs.statSync(full).isDirectory();
    });

    const catPatternCounts = {};

    for (const folder of categoryEntries) {
      if (shouldSkipFolder(folder)) {
        console.log(`  ⏭  Skip folder: ${pack.id}/${folder}`);
        continue;
      }

      const catId = normalizeFolderName(folder);
      if (!catId) {
        console.warn(`  ⚠  Unknown folder: ${pack.id}/${folder}`);
        continue;
      }

      const srcFolder = path.join(pack.midiDir, folder);
      const dstFolder = path.join(OUT_DIR, pack.id, catId);
      fs.mkdirSync(dstFolder, { recursive: true });

      const files = fs.readdirSync(srcFolder).filter(
        (f) => f.endsWith(".mid") && !f.includes("_COMPAT")
      );

      for (const file of files) {
        const stem = path.basename(file, ".mid");
        const parsed = parseFilename(stem, pack.id);

        if (!parsed) {
          console.warn(`    ⚠  Cannot parse: ${file}`);
          totalErrors++;
          continue;
        }

        const srcPath = path.join(srcFolder, file);
        const dstPath = path.join(dstFolder, file);

        try {
          fs.copyFileSync(srcPath, dstPath);
        } catch (e) {
          console.error(`    ✗  Copy failed: ${file} — ${e.message}`);
          totalErrors++;
          continue;
        }

        const publicPath = `/midi-library/${pack.id}/${catId}/${file}`;

        index.patterns.push({
          id: stem,
          pack: pack.id,
          category: catId,
          instrument: parsed.instrument,
          key: parsed.key,
          scale: parsed.scale,
          bpm: parsed.bpm,
          swing: parsed.swing,
          bars: parsed.bars,
          variation: parsed.variation,
          program: parsed.program,
          path: publicPath,
        });

        catPatternCounts[catId] = (catPatternCounts[catId] ?? 0) + 1;
        packEntry.patternCount++;
        totalCopied++;
      }
    }

    // Build category list (only cats that have files)
    packEntry.categories = Object.entries(catPatternCounts).map(([id, count]) => ({
      id,
      name: CAT_DISPLAY[id] ?? id,
      count,
    }));

    index.packs.push(packEntry);
    console.log(`✓  ${pack.id} — ${packEntry.patternCount} patterns`);
  }

  // Sort patterns for consistent output
  index.patterns.sort((a, b) =>
    a.pack.localeCompare(b.pack) || a.category.localeCompare(b.category) || a.id.localeCompare(b.id)
  );

  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));

  console.log(`\n✅  Done. Copied ${totalCopied} files, ${totalSkipped} skipped, ${totalErrors} errors.`);
  console.log(`   Index: ${INDEX_PATH}`);
  console.log(`   Total patterns: ${index.patterns.length}`);
}

main();
