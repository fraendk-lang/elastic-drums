# Landing Page Refresh — Design Spec

## Goal

Update `elastic-groove-landing/index.html` to reflect the current state of Elastic Groove: new screenshot, updated positioning as "Professional Browser Groove Machine", refreshed feature cards and stats.

## Decisions

| Question | Decision |
|---|---|
| Layout | A — Centered Hero (evolved current, no structural change) |
| Headline | Keep "Make Beats. Shape Sound." |
| Positioning | "Professional Browser Groove Machine" |
| Screenshot | User provides new `og-image.png` — replaces existing file |

---

## Changes

### 1. Nav — add Launch App button

Add a primary CTA button in the nav alongside the existing links:

```html
<nav>
  <div class="nav-logo">ELASTIC GROOVE</div>
  <div class="nav-links">
    <a href="#features">Features</a>
    <a href="https://app.elasticgroove.app" class="btn-primary btn-sm">Launch App →</a>
  </div>
</nav>
```

Add CSS for `btn-sm`:
```css
.btn-sm { font-size: 12px; padding: 7px 16px; }
```

### 2. Hero eyebrow

Old:
```html
<p class="hero-eyebrow">Browser Groovebox &middot; No Install Required</p>
```

New — pill-style badge:
```html
<p class="hero-eyebrow">Professional Browser Groove Machine</p>
```

Update CSS — add border + rounded pill style:
```css
.hero-eyebrow {
  display: inline-block;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--amber);
  border: 1px solid rgba(245,158,11,0.25);
  border-radius: 20px;
  padding: 4px 14px;
  margin-bottom: 20px;
}
```

### 3. Hero subheadline

Old:
```html
<p class="hero-sub">
  A professional drum machine and sequencer that runs entirely in your browser —
  VA synthesis, real samples, 303-style bass synth and a full arrangement view.
</p>
```

New:
```html
<p class="hero-sub">
  VA drum synthesis, 303 acid bass, piano roll, chord pads and a full arrangement
  timeline — professional music production that runs entirely in your browser.
</p>
```

### 4. Pills

Old:
```html
<span class="pill">VA Synthesis</span>
<span class="pill">Sample Engine</span>
<span class="pill">Step Sequencer</span>
<span class="pill">303 Bass Synth</span>
<span class="pill">Arrangement</span>
<span class="pill">Free</span>
```

New — add Chord Pads, highlight Free:
```html
<span class="pill">Drum Engine</span>
<span class="pill">303 Bass</span>
<span class="pill">Piano Roll</span>
<span class="pill">Chord Pads</span>
<span class="pill">Arrangement</span>
<span class="pill">Mixer & FX</span>
<span class="pill pill-gold">Free · No Install</span>
```

Add CSS:
```css
.pill-gold {
  background: rgba(245,158,11,0.12);
  color: var(--amber);
  border-color: rgba(245,158,11,0.25);
}
```

### 5. Stats row

Old:
```html
<div class="stat"><div class="stat-num">24</div><div class="stat-label">Factory Kits</div></div>
<div class="stat"><div class="stat-num">2308</div><div class="stat-label">Drum Samples</div></div>
<div class="stat"><div class="stat-num">64</div><div class="stat-label">Step Sequencer</div></div>
<div class="stat"><div class="stat-num">12</div><div class="stat-label">FX &amp; Sends</div></div>
```

New:
```html
<div class="stat"><div class="stat-num">24</div><div class="stat-label">Factory Kits</div></div>
<div class="stat"><div class="stat-num">1700+</div><div class="stat-label">Drum Samples</div></div>
<div class="stat"><div class="stat-num">64</div><div class="stat-label">Step Sequencer</div></div>
<div class="stat"><div class="stat-num">Free</div><div class="stat-label">Forever</div></div>
```

### 6. Feature cards — replace all 6

Old feature 4 was "Arrangement View". New order puts Piano Roll & Chord Pads as feature 4, Arrangement as feature 5, Export & Share stays as feature 6:

```html
<!-- Feature 1 — unchanged content, minor wording -->
<div class="feat">
  <div class="feat-icon">🥁</div>
  <div class="feat-title">808 / 909 Drum Engine</div>
  <div class="feat-desc">12-voice VA drum synthesis with per-voice tune, decay, drive, sub and FM. Load your own samples on any pad.</div>
</div>

<!-- Feature 2 — unchanged -->
<div class="feat">
  <div class="feat-icon">🎛️</div>
  <div class="feat-title">Pro Step Sequencer</div>
  <div class="feat-desc">64 steps, Parameter Locks, 16 Conditional Triggers, Ratchet, Swing and Euclidean rhythm generator.</div>
</div>

<!-- Feature 3 — unchanged -->
<div class="feat">
  <div class="feat-icon">🎹</div>
  <div class="feat-title">303-Style Acid Bass</div>
  <div class="feat-desc">Self-oscillating filter, accent, slide and portamento. Full piano-roll sequencer built in.</div>
</div>

<!-- Feature 4 — NEW: Piano Roll & Chord Pads -->
<div class="feat">
  <div class="feat-icon">🎵</div>
  <div class="feat-title">Piano Roll &amp; Chord Pads</div>
  <div class="feat-desc">72-note melody piano roll and performance chord pads with editable chord intervals.</div>
</div>

<!-- Feature 5 — updated: Mixer & FX with more detail -->
<div class="feat">
  <div class="feat-icon">🎚️</div>
  <div class="feat-title">Mixer &amp; FX</div>
  <div class="feat-desc">12-channel mixer with FFT metering, per-channel 3-band EQ, reverb, delay, chorus, phaser and brick-wall master limiter.</div>
</div>

<!-- Feature 6 — updated: Arrangement with more detail -->
<div class="feat">
  <div class="feat-icon">🎼</div>
  <div class="feat-title">Arrangement View</div>
  <div class="feat-desc">Clip-based timeline with automation lanes, loop regions and drag &amp; drop editing. Build full songs, not just loops.</div>
</div>
```

### 7. Screenshot

Replace `elastic-groove-landing/og-image.png` with the new screenshot file provided by the user. Also update OG/Twitter meta tags if the image dimensions change.

The `<img>` tag in the hero stays the same:
```html
<img src="/og-image.png" alt="Elastic Groove — browser groove machine interface" width="1200" height="630" loading="eager" />
```

Update `alt` text: "drum machine interface" → "browser groove machine interface".

---

## File

Single file: `elastic-groove-landing/index.html`  
Screenshot asset: `elastic-groove-landing/og-image.png` (user-provided)

No build step — static HTML, deployed via Vercel.

---

## Verification

1. Open `elastic-groove-landing/index.html` locally in browser
2. Nav has "Launch App →" button
3. Eyebrow reads "Professional Browser Groove Machine" as pill badge
4. Subline mentions piano roll, chord pads, arrangement timeline
5. Pills: Drum Engine, 303 Bass, Piano Roll, Chord Pads, Arrangement, Mixer & FX, Free · No Install (gold)
6. Stats: 24 / 1700+ / 64 / Free
7. Feature 4 is "Piano Roll & Chord Pads", Feature 5 is "Mixer & FX", Feature 6 is "Arrangement View"
8. New screenshot visible in hero frame
9. OG/Twitter preview image updated
