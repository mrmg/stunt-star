# Visual pass: light, framing and signature shots

Goal: every stunt should look like a shot from its film, not an empty test level. The best-looking sets (Raiders,
Thelma & Louise, the Police Story mall, the silent-film stunts) share four things: an **enclosed set** that frames
the action, **low directional light** with real shadows, **atmosphere** (haze that fades into the backdrop), and a
**strong grade**. The weak ones are open countryside at noon: flat bright-green ground, sparse cartoon trees,
empty horizons. This pass fixes that with no new generated assets.

Reference implementation: `smokey` (Bridge Out) in `src/stunts/drive1.js`. Look at its `build()` and its `cine` entry.

## 1. Lighting and grade

- Presets live in `ENV` in `src/world/stage.js`. `day` is now a lower, warmer 33° sun. Other choices:
  - `golden`: low sun.
  - `dusk`.
  - `overcast`: soft light, good for gritty 70s films.
  - `desert`, `snow`, `jungle` and `night`.
- Pick what the film was actually shot in.
- `s.env(preset, { ...overrides })` accepts any preset field:
  - `sun: [elevationDeg, azimuthDeg]`, `sunCol`, `sunI`, `amb`.
  - `fog` (exp2 density; ~0.001–0.003 outdoors).
  - `fogColor`, `fogMix`, `hz` (backdrop horizon height).
  - `look`: grades in `LOOKS` in `src/core/engine.js`.
  - `lookOver: { bloom, grain, sat, contrast, vignette, tint: [r,g,b] }`.
- Haze should make distance fall off into the backdrop colour; a bit more fog than "clear" usually looks better.
- `s.ground()` and `s.terrain()` now break up tiling with world-space colour variation and dry/wet patches,
  per texture (`VARY_DEF` in stage.js).
  - Pass `vary: { lo, hi, patch, amt, scale, tint }` to tune, or `vary: false` to disable.
  - Grass is now tinted darker and less saturated by default.

## 2. Framing the set: `src/world/dress.js`

`import * as dress from '../world/dress.js'`. All visual only (no collisions) and instanced.

- `dress.treeLine(s, { x, z0, z1 | path: [[x,z],...], side: ±1, depth, step, kinds: ['pine','oak','palm','cypress','jungle','dead','snowpine','bush'], h: [min,max], seed, bushes })`
  - A forest edge along a line.
  - `side` = which way the band extends.
- `dress.berm(s, { x, z0, z1 | path, side, w, h, off, tex, color })`: a grassy/earth bank.
- `dress.fence(s, { x, z0, z1 | path, kind: 'rail'|'wire'|'picket'|'barrier'|'guard', h, gap, color })`.
- `dress.bales(s, [[x,z,ry],...], { round, stack })`: hay bales.
- `dress.poles(s, { x, z0, z1 | path, gap, h })`: telegraph poles with sagging wires.
- `dress.crowd(s, { x, z0, z1 | path, rows, step, side, face, tier, y, colors, gaps })`
  - Instanced low-poly spectators.
  - `face` = yaw they look toward (0 faces -Z).
- `dress.barn(s, { x, z, w, d, h, ry, color, roof })`: gable-roofed barn, shed or farmhouse.
- `dress.hills(s, { x, z, r, a0, a1, h, depth, color, tex, trees, nTrees })`: a ring of distant hills that closes the horizon.

Also available: `s.trees(kind, n, area, o)`, `s.forest(modelId, n, area, o)`, `s.put(modelId, o)` for generated models
(see `assets.models` of the stunt and `MODEL_META` in `src/core/assets.js`), `s.box`, `s.cyl`, `s.building`, `s.row`
(rows of buildings), `s.road`, `s.light`, `sign()` in `src/stunts/common.js`.

Rules:
- Never put dressing in the driving/running line, or anything solid where the bot or player goes.
- Keep it believable for the film (Georgia back road ≠ Swiss Alps ≠ Bangkok).
- Frame the action: tree lines, banks, buildings or crowds at **20–60 m** from the path, plus a few foreground
  things near where the replay cameras sit.
- Don't wall the action in so tightly that it reads as a corridor.
- Budget: roughly ≤ 1,500 extra tree instances and ≤ 600 crowd figures per stunt; no per-frame allocations.

## 4. Signature shots

Replays cut the best moment from several angles. `def.cine` (or a moment's `shots`) is a list of shot specs:
`{ type, speed, a, b, fov, side, dist, at, heading, pos, lookUp }`.

- `type`:
  - `wide`: long-lens pan from the side.
  - `front`: from ahead, looking back at the subject.
  - `low`: ground camera ahead of the action.
  - `track`: alongside.
  - `rear` and `chase`: from behind.
  - `orbit`.
  - `top`: overhead.
- `a`/`b` are the fraction of the moment's window to use (can go below 0 or above 1); `speed` is the playback rate.
- **`pos: [x, y, z]`** places a fixed, hand-picked camera (it tracks the subject).
  - `lookUp` raises the aim point in metres; for a person, ~0.5–0.9 aims at the chest.
  - Use it for each film's famous angle, e.g. Canyon Leap's view from across the gorge, or Bridge Out's
    riverbank profile of the Trans Am in mid-air.
- Live cuts during play: `s.cut(pathPts, type, { pos, fov, R })` (see the hat grab in `temple_door`);
  drive stunts also have `liveShot`/`liveShots` in their EXTRA entries.

Per stunt, aim for:
- one shot that recreates the iconic frame, placed by hand with `pos`;
- the automatic angles for the rest.

## Testing

- Test server: `http://localhost:5173/` (no hot reload; fresh page loads get your latest code).
- Frozen build of the code before this pass: `http://localhost:5182/`.
- `TAG=before_ BASE=http://localhost:5182/ timeout 110 node tools/play.mjs <id> 2 2,6`: "before" shots.
- `TAG=after_ timeout 110 node tools/play.mjs <id> 2 2,6`:
  - The bot plays the stunt and writes `shots/after_<id>_0.jpg` and `_1.jpg` at sim-time 2 s and 6 s.
  - It also writes `_replay0..N.jpg` (one per replay cut) and `_end.jpg`.
  - It prints the result line; the bot must still pass.
- Add `FRAMES=300` to get a replay frame every 300 ms (`_f01.jpg`…).
- Pick screenshot times that land on the stunt's key moment.
- `montage a.jpg b.jpg ... -resize 420x -tile 3x -geometry +3+3 out.jpg` (ImageMagick) makes a contact sheet;
  view it with the Read tool.
