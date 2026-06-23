# Design System: Instrument Telemetry
**Skill:** instrument-telemetry-hud

A design language for interfaces that read like instruments. Every screen is a panel of gauges, readouts, and live data on a black void - the cockpit, the terminal, the mission-control wall, the dashboard cluster. Function is the ornament. Glow is earned. Nothing is decorative that isn't also a measurement.

> Derived from a 24-image reference set spanning CRT system monitors, sci-fi FUI (fictional UI), trading terminals, vehicle clusters, seven-segment readouts, satellite ground-control screens, and dense telemetry dashboards. The unifying thread: **the screen is a machine, and the machine is reporting its state.**

---

## Configuration - Set Your Style
Adjust these dials before building. They control how raw, dense, and alive the output should be. Pick the level that fits the project.

| Dial | Level | Description |
|------|-------|-------------|
| **Density** | `8` | `1` = One hero readout, breathing room (a smartwatch complication). `5` = A few grouped panels. `10` = Mission-control wall - every pixel reports something. Default: `8` |
| **Decay** | `4` | `1` = Crisp modern OLED, no artifacts. `5` = Faint phosphor bloom + subtle scanline. `10` = Full CRT: bloom, scanlines, vignette, grain, slight curvature. Default: `4` |
| **Accent Spread** | `2` | `1` = Monochrome - one accent hue, nothing else. `5` = Primary hue + a warning hue. `10` = Full heat-map spectrum (red→amber→yellow→green→cyan). Default: `2` |
| **Motion Intent** | `6` | `1` = Static snapshot. `5` = Live values tick, cursors blink. `10` = Everything streams - sweeping radar, scrolling logs, oscillating meters. Default: `6` |

> **How to use:** Change the numbers to match the project. At **Density 1-3 / Accent 1**, the system produces a single calm readout - an Apple Watch complication, a thermostat. At **Density 8-10**, expect Bloomberg-terminal walls and satellite ground stations. **Decay** is the era dial: `0-2` reads as a modern product, `7-10` reads as salvaged 1980s hardware. Everything below adapts to these levels.

---

## 1. Visual Theme & Atmosphere
A black operational void populated by self-contained instrument panels. The mood is alert, technical, and unsentimental - you are monitoring something that matters, in real time, possibly at 3 a.m. Light comes only from the data: phosphor-glowing numbers, illuminated meters, status LEDs. There is no "page," there is a **console**. Whitespace is not airy and luxurious here - it is the dark gap between instruments, and it makes the lit elements read as emissive.

The signature feeling: **emissive data on a dead-black field.** A figure isn't styled, it's *lit up*. A panel isn't a card, it's a *housing* with a labeled header and a thin bezel. The interface should feel like it could be telling you something is about to fail.

Reference touchstones: VAX/OpenVMS system monitors, automotive instrument clusters (VFD green, segmented red), Bloomberg/trading terminals, sci-fi heads-up displays, satellite and rocket ground-control screens, audio/VU metering, oscilloscopes.

## 2. Color Palette & Roles
The base is non-negotiable: **black, or as near to black as the panel chrome allows.** Unlike consumer "soft dark mode," pure black is *correct* here - it is what makes phosphor glow read as emission rather than fill.

### Base & Structure
- **Void Black** (`#000000`) - Primary canvas. The dead space between instruments. Pure black is allowed and encouraged.
- **Panel Black** (`#0A0C0E`) - Instrument housing fill. A hair above void so bezels separate from background.
- **Bezel Line** (`#1C2024` / `rgba(255,255,255,0.08)`) - 1px panel borders, grid lines, table rules. Thin, cool, structural.
- **Inset Graphite** (`#14181C`) - Recessed wells: chart backgrounds, the unlit portion of a meter, input fields.
- **Label Gray** (`#6B7280` → `#8A94A0`) - Inert labels, axis ticks, units, timestamps. Never the star; it frames the data.

### Signal Accents - Pick ONE primary per screen (raise *Accent Spread* to add more)
Each evokes a specific display technology. Commit to one as the dominant emissive hue.
- **Phosphor Green** (`#16FF6B`, glow `#39FF14`) - Terminal/VFD/radar. The default "all systems nominal" hue. Most versatile. For surfaces read for hours, soften to a **Signal Green** (`#54D693`-class - ~55-65% saturation, ~55-58% lightness): still emissive on black, far less glare. See *Readability Calibration* below.
- **CRT Amber** (`#FF8A00`, deep `#FFB000`) - Vintage monochrome monitors, sodium-lamp warmth. Calm, retro, legible.
- **Alert Red** (`#FF3B30`, deep `#E5001E`) - Seven-segment speedo, warnings, sell-side, failure. High urgency - use sparingly as primary, always as the warning hue.
- **HUD Cyan** (`#2DE2FF`, electric `#00E5FF`) - Sci-fi heads-up, sonar, navigation, "active feed." Cold, futuristic, technical.
- **Signal Yellow** (`#FFE83D`) - Caution band, idle state, the top of a heat ramp.

### Semantic Roles (consistent across every screen)
- **Nominal / Active / Gain** → Phosphor Green
- **Warning / Caution / Idle** → Signal Yellow or Amber
- **Critical / Alert / Loss** → Alert Red
- **Selected / Live cursor / Focus** → HUD Cyan (or the screen's primary, inverted)
- **Inert / Off / Unlit** → Inset Graphite at ~20% of the lit hue

### Heat-Map Ramp (data viz only - bars, density maps, gauges)
For continuous magnitude, ramp **deep red → orange → amber → yellow**, optionally cool toward green/cyan at the low end. This is the stacked-bar and dot-matrix language. Keep it on black; let intensity equal brightness.

### Readability Calibration (Sustained Use)
The palette above is tuned for *glanceable* instruments - a status wall you scan in a second. When the surface is meant to be **read for hours** (an agent inspector, a code/log console, a workstation), pull the dials toward calm to avoid chromatic glare and eye strain:

- **Soften the primary.** Desaturate and slightly lower the lightness of the chosen accent (Phosphor Green `#16FF6B` → Signal Green `#54D693`; Alert Red `#FF3B30` → `#E15B58`; HUD Cyan `#2DE2FF` → `#54D3E0`; Amber → `#DCA74C`). It still reads as emissive on black without the neon.
- **Reserve glow for the single focal readout.** Secondary lit values - tabular counts, active tabs, row LEDs, syntax accents, status pills - use *flat* accent color with **no** `text-shadow`/`box-shadow`. Many glowing elements compete for the eye and read as glare, not emission.
- **Nudge the void off pure black** by a hair (`#040508`-`#0A0C0E`) so high-contrast accents don't burn at 3 a.m. This is still instrument black - not consumer charcoal (`#1E1E2E` stays banned).
- **Keep tabular-mono body text bright** (`#E2E8EE`-class); readability comes from the *labels* stepping down to gray, never from dimming the data itself.

Rule of thumb: the harsher the accent and the more places it glows, the more the interface reads as a *gimmick*. Restraint reads as *professional*. If the brief is "professional, not gimmicky," default to this calibration.

### Banned Colors
- **Soft "consumer dark mode" grays** (`#1E1E2E` warm charcoals, Discord/Slack navy) - this is an *instrument*, not a chat app.
- **Pastels, lavender, "AI purple" gradients** - wrong technology, wrong decade.
- **More than one saturated primary accent per screen** unless *Accent Spread ≥ 6*. Restraint is the look.
- **Full-saturation accent used as a large fill** - accents glow on small marks (numbers, lines, dots), they do not paint big areas.
- **White (`#FFFFFF`) as primary text.** Primary readouts are *colored light*; structural labels are gray. Pure white appears only for the occasional high-value figure, and even then prefer `#E8EDF2`.

## 3. Typography Rules
Type here is **machine type.** Monospace is the default voice, not an accent. Two register decisions drive everything: *labels* (small, gray, tracked-out, uppercase) and *readouts* (large, emissive, often segmented).

- **Mono (the workhorse):** `JetBrains Mono`, `IBM Plex Mono`, `Geist Mono`, `Berkeley Mono`, or `Space Mono`. Used for **all numbers, labels, units, tables, logs, timestamps, axis ticks.** Tabular figures mandatory (`font-variant-numeric: tabular-nums`) so digits don't jitter as values change.
- **Labels:** Mono, `0.6875-0.8125rem`, `UPPERCASE`, letter-spacing `0.08-0.16em`, Label Gray. This wide-tracked caps label is the single most recognizable typographic move in the set - use it on every panel header, axis, and unit.
- **Readouts (the hero numbers):** A segmented or squared display face for primary values - `DSEG7`/`DSEG14` (seven/fourteen-segment), `Doto`, `Micro 5`, or a heavy squared techno face (`Eurostile`/`Michroma`/`Orbitron`) for control-panel headers. Big, emissive, tight. This is where a screen earns its "instrument" identity.
- **Display / Panel titles (optional):** A squared grotesque (`Michroma`, `Eurostile`, `Chakra Petch`) in caps for section banners like `RESOURCE OVERVIEW`. Keep it to titles; never body.
- **Scale:** Readouts `clamp(2rem, 6vw, 5rem)`. Panel titles `1-1.5rem`. Body/labels `0.75-0.875rem`. Table cells `0.75rem`. Density is high - small type is correct, but never below `11px` and never below tabular legibility.
- **Hierarchy by emission, not just size:** the most important number is the *brightest* (full accent + subtle glow); everything else steps down toward gray. Lit = important.

### Banned Fonts
- **Humanist sans as primary** (`Inter`, `Helvetica`, `SF Pro` body) - fine for nothing here; the voice is mono. A geometric/squared sans is acceptable only for large titles.
- **Any serif** - wrong machine entirely.
- **Proportional figures in data** - always tabular. Misaligned changing digits break the instrument illusion.

## 4. Component Stylings
* **Panels (the core unit):** A bordered housing, not a soft card. Fill Panel Black, `1px` Bezel Line, radius `0-6px` (sharp reads more technical; small radius reads as modern hardware). A **labeled header bar** - uppercase tracked mono title, optional unit/status on the right. Optional **corner brackets** (`⌐ ¬ L ⌙`) framing the panel or key values - a signature HUD device seen across the set. Internal padding tight (`0.75-1.25rem`); these are dense.
* **Readout blocks:** Big segmented value + small unit + tiny label, vertically stacked or inline (`7,905.26` `PSI`). Pair with a trend arrow (▲▼) in the semantic color and a delta. The value glows; the unit is gray.
* **Gauges & meters:** Radial dials with tick marks and a needle/arc; linear bar meters; **segmented LED bars** (discrete lit cells, unlit cells at ~20%); VU-style stacks. Show the scale (`0...100`, `30 80 120`) and a labeled threshold. The lit portion uses the heat ramp or accent; the track is Inset Graphite.
* **Dot-matrix / heat grids:** Grids of small squares, brightness = magnitude (the "databases deployed" and step-count motifs). Lit cells in accent/ramp, empty cells barely visible. Great for activity-over-time.
* **Charts:** Drawn on Inset Graphite wells with a faint grid. Thin `1-1.5px` emissive strokes, no thick area fills unless stacked heat-ramp. Axis ticks and labels in tracked mono gray. Crosshair cursor in cyan. Sparklines inline in tables.
* **Tables (first-class citizen):** Dense, mono, tabular figures, `1px` row rules in Bezel Line, uppercase tracked header row. Status conveyed by cell text color (green/red/amber), occasionally a faint row-tint for alerts. Right-align all numerics. This is how the trading-terminal and ground-control screens carry most of their information.
* **Status indicators:** Small LED dots (filled circle + faint glow) - green/amber/red. Status pills are rectangular, thin-bordered, uppercase mono (`ACTIVE`, `ONLINE`, `BREACH`, `IDLE`). Avoid rounded “chips”; keep them squared like panel labels. **Event / span chips** (trace timelines, log streams, event rows): the **border** carries the event-type hue (the colored signal) while the **label** stays foreground (`#E2E8EE`-class) — coloring the text the same hue as its own border is a redundant encoding and dims the readable word (see *Information Economy*). Radius ~`2px`: harder than a soft chip, not dead square; the field between borders stays empty.
* **Buttons / controls:** Rectangular, thin-bordered, uppercase mono label. Default = ghost (border only, gray text). Active/selected = accent border + accent text, or inverted (accent fill, black text) for the one primary action. Tactile press: brief inset/brightness flash, not a bounce. Toggle banks and tab strips (`01 02 03 04 ...`) appear as rows of equal bordered cells with the active cell lit.
* **Inputs / selects:** Inset Graphite well, `1px` border, mono text, label as a tracked caps tag above or inline. Focus = accent border, optional faint accent glow. Dropdowns read as `Type: A100 GPUs ⌄`.
* **Loaders:** A sweeping line/scan, a blinking cursor, an incrementing counter, or a progress bar with a moving lit head - never a soft circular spinner.

## 5. Hero / Primary View
The "hero" of an instrument screen is **the most important live value or the master visualization**, not a marketing headline.
- **Lead with the measurement.** A giant segmented readout, a master gauge, or the primary chart anchors the view. Surround it with its supporting telemetry (units, thresholds, trend, secondary stats in corner brackets).
- **Summary strip.** A top bar of key scalar readouts (the trading-terminal pattern: `24H CHANGE  HIGH  LOW  TURNOVER`) gives instant situational awareness before the detail panels.
- **No marketing chrome.** No "Get started," no hero illustration, no value-prop subhead. If this is a landing page dressed as an instrument, the headline itself becomes a readout - set in segmented/mono caps, treated as if the system is printing it.
- **One focal emission.** Exactly one element should be the brightest thing on screen - and the only one that *glows*. Everything else supports it with flat color. The eye should land instantly on what matters most; many glowing elements compete and read as glare (see *Readability Calibration*).

## 6. Layout Principles
- **Modular instrument grid.** Compose from rectangular panels of varying span on a strict grid - a bento of instruments. Mission-control density tiles many small panels; a focused tool uses a few large ones. Use **CSS Grid**, named areas, consistent gutters (`8-16px`).
- **Alignment is everything.** Numbers right-align, labels left-align, columns lock to a baseline grid. Misalignment destroys the precision the whole look depends on.
- **The black gutter is the divider.** Separate panels with dark gaps and thin bezels, not shadows or rounded cards. Elevation is communicated by border and the faint glow of contents, never by drop shadow.
- **Corner brackets & rules as structure.** Frame regions with `[ ]` brackets, tick-marked rulers, and `1px` divider lines. These read as engineering drawing furniture and reinforce the instrument metaphor.
- **Reading order top-left → detail.** Headers and summary scalars top; primary visualization center/left; supporting tables and logs flanking and below. Mirror how a real control surface is laid out.
- **Containment.** Console apps can run edge-to-edge (full-bleed wall). Documents/landing variants cap content at `~1440px` but keep the black bleeding past the panels.

### Information Economy (Respect the Screen)
Density is the look - but density is not the same as *clutter*. The instrument fantasy collapses the moment a screen feels like it's trying too hard: badges that restates the obvious, indicators stacked on indicators, chrome headers labelling a view whose context already says what it is. The discipline that separates a *professional* console from a *gimmicky* one is ruthless subtraction. Every element must earn its pixels.

- **Cut chrome that restates context.** A panel titled `Agent · Detail` on the agent-detail view, or `Agent Catalog` at the top of the agent list, is noise - the user is already there. Let the content be the header (the selected item's name + its one key attribute). Only label a panel when its purpose isn't obvious from what's inside.
- **One encoding per fact.** If a green dot already says "selected," do not also add the word `SELECTED`, a row tint, *and* a badge. Pick the single strongest signal and let it carry the meaning; secondary echoes are clutter. (A faint row tint *plus* a dot is fine - they reinforce one interaction state. A dot *plus* a word *plus* a pill, all meaning the same thing, is not.)
- **Reserve lit indicators for meaningful state.** A status LED means something (live, selected, nominal, fault). An unlit dot on every idle row is decoration, not data - "light comes only from the data" cuts the other way too. Show the dot when there's a state to report; leave empty space otherwise.
- **State a unit once.** Don't append `tok` (or `ms`, `%`, `rq`) after every number in a table or strip. The column header, the label, or the first value carries the unit; the rest inherit it. Repeated units read as the interface not trusting you to remember.
- **Make the count describe what you're looking at.** A telemetry strip of *every* metric (total / context / prompt / ...) is an overview masquerading as a header - it competes with the content for attention. When a view is scoped to one thing (one tab, one selection), show *that thing's* number, and let it change as the scope changes. Reserve the full overview for a sidebar/inspector where overview belongs. The number should narrate the current view, not the whole system.
- **No decorative numbering.** `01 02 03 04` on a four-tab strip whose labels are `System / Context / Combined / Template` adds bytes, not information. Number only when order or count is itself the data.
- **Headers should organize, not annotate.** A group label (`INTAKE`, `BUILD`) is structure. A group label *plus* an index (`01`) *plus* a count (`02`) on a three-item list is three signals for one fact. The list is right there; let people count it.
- **One fact, one home.** If the model is shown in the hero, don't also pin it to the panel header and the inspector. Overview goes in the overview; the exhaustive detail goes in the detail panel. Duplication forces the eye to wonder which is canonical.
- **When in doubt, leave it out.** The default answer to "should I add a badge / pill / count / icon here?" is no. Add it only when its absence makes the screen ambiguous. Restraint reads as confidence; stuffing reads as insecurity.

This is the other half of *Readability Calibration*: the former softens the **light**, this tightens the **signal**. Together they are what makes the aesthetic feel professional instead of gimmicky.

## 7. Responsive Rules
Instrument density is the hardest thing to make responsive - plan the collapse, don't let it break.
- **Reflow panels, don't shrink them.** Multi-column instrument grids collapse to fewer columns, then a single stacked column under `768px`. Never scale a whole panel down until its labels are unreadable.
- **Protect tabular legibility.** Numbers stay `≥ 11px` and tabular. If a wide data table can't fit, make *it* (and only it) horizontally scroll inside its panel - never the whole page.
- **Prioritize the readout.** On small screens, lead with the single most important value and the summary strip; demote dense tables and secondary charts below the fold or behind tabs.
- **Touch targets `≥ 44px`** for any control, even though the desktop aesthetic is small and tight. Give toggles/tabs room on mobile.
- **Decay scales down.** Heavy scanline/grain/curvature (high *Decay*) hurts on small dense screens - reduce artifact intensity below `768px`.
- **Test at** `375px`, `768px`, `1024px`, `1440px`, and one ultra-wide (`1920px+`) since these designs often live on big monitors.

## 8. Motion & Interaction (Code-Phase Intent)
> Motion sells the "live machine." Values should feel *measured in real time*, not animated for delight.

- **Live values tick.** Numbers roll/count to new values with tabular digits; don't cross-fade whole strings. Small, frequent updates read as a real feed.
- **Perpetual instrument loops.** Status LEDs pulse; radar/sonar sweeps rotate; oscilloscope traces scroll; VU meters oscillate; a scan line crosses a loading panel; the active cursor blinks at ~1Hz. Keep these subtle and isolated.
- **Streaming logs & tickers.** New rows enter at top/bottom and push the stack; tickers scroll horizontally at constant linear speed (the one place linear easing is correct - machines don't ease).
- **Threshold reactions.** When a value crosses a limit, the relevant element snaps to the warning/critical color and may pulse. State changes are *immediate and discrete*, like a real alarm, not a gentle 600ms tween.
- **Cursor & selection.** Hovering a chart shows a cyan crosshair with a readout callout; selecting a row tints it and lights its LED. Interactions feel like *probing an instrument*.
- **Phosphor persistence (high Decay).** Bright elements can leave a brief glow trail / slow fade-out, mimicking CRT persistence. Use sparingly.
- **Hardware rules.** Animate `transform` / `opacity` / color only. Isolate perpetual loops in small leaf components so streaming data never re-renders whole panels. Target 60fps; respect `prefers-reduced-motion` by freezing sweeps and disabling pulsing.

## 9. CRT / Decay Treatment (optional, driven by the Decay dial)
Layer these as fixed, `pointer-events:none` overlays so they never affect layout or hit-testing. Scale with *Decay*:
- **Scanlines** - faint horizontal `repeating-linear-gradient`, very low opacity.
- **Phosphor bloom** - subtle `text-shadow`/`box-shadow` in the element's own hue. The *one* place glow is encouraged, and it belongs on **the single focal readout only** (the hero number, the live cursor). Secondary lit values use flat accent color - glow on many elements reads as glare, not decoration. Keep intensity low (`~0.25-0.3` alpha, `4-5px` radius) for sustained reading; raise it only for true glanceable walls. See *Readability Calibration*.
- **Vignette** - radial darkening at the edges, as if light falls off a tube.
- **Grain / flicker** - micro noise and an occasional faint brightness flicker.
- **Curvature** (high Decay only) - slight barrel distortion + corner darkening for a salvaged-CRT feel.

## 10. Anti-Patterns (Banned)
- **No soft consumer dark mode** - no warm charcoal `#1E1E2E`, no rounded glassy cards, no Slack/Notion vibe. This is hardware.
- **No drop shadows for elevation** - separation comes from black gutters, bezels, and emission.
- **No big saturated fills** - accents glow on thin marks (numbers, strokes, dots, small cells), never as large painted backgrounds.
- **No proportional/jittery numbers** - tabular mono figures everywhere, always.
- **No serif, no humanist-sans body** - the voice is monospace; squared sans only for large titles.
- **No more than one primary accent per screen** unless *Accent Spread ≥ 6*; never a rainbow of equal-weight accents.
- **No decorative gradients, no glassmorphism, no neumorphism, no AI-purple** - wrong machine, wrong decade.
- **No neon glare on sustained-read surfaces** - don't apply full-saturation accents plus glow to many elements at once. That reads as a gimmick, not an instrument. Soften the primary, reserve bloom for the focal value (see *Readability Calibration*).
- **No emojis** anywhere in the UI.
- **No circular loading spinners** - use scan lines, blinking cursors, counters, or progress heads.
- **No rounded pill chips for status** - squared, thin-bordered, uppercase mono.
- **No marketing chrome on console views** - no "Scroll to explore," hero illustrations, or value-prop subheads. The data is the content.
- **No misalignment** - every number, axis, and column locks to the grid. Sloppy alignment reads as broken instrumentation.
- **No fake-clean round data** (`100%`, `1,000,000`) - instruments report organic precision (`41,092`, `7,905.26`, `+3.01%`, `136 AQI`).
- **No context-restating chrome** - panel/section headers that label a view whose purpose is already obvious from context ("Agent Detail" on the agent-detail screen). The content is the header.
- **No redundant encodings** - showing one fact as both a dot *and* a word *and* a pill. Pick the single strongest signal (see *Information Economy*).
- **No repeated units / decorative numbering** - appending the unit to every value, or numbering self-evident tabs (`01 System / 02 Context`). State the unit once; number only when count is the data.
- **No decorative idle indicators** - unlit status dots on every row that has no state to report. Lit indicators report state; they aren't ornament.
- **No white-on-black body text as the default** - primary values are *colored light*; framing text is gray.
