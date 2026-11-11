# AAA asset pack — image-to-3D reference queue (wave 2)

Status: **prompts written and queued, generation blocked on fal.ai balance** (verified 11 Nov 2026:
`node tools/gen.mjs --only set_boulder --img-only` → `User is locked. Exhausted balance`).
The moment the balance is topped up, the whole pack generates with two commands — no further writing needed.
Until then, `fruit_cart`, `cardboard_boxes` and `fire_hydrant` already render as detailed procedural
stand-ins (see `PROCEDURAL` in `src/core/assets.js`); a generated `.glb` replaces them automatically.

## Run it (when funded)

```bash
node tools/gen.mjs --img-only            # 1. reference images only: review them in assets-src/img/ (~$0.08 each)
node tools/gen.mjs                        # 2. image -> 3D -> optimised GLB in public/models/ (skips anything on disk)
node tools/missing.mjs                    # confirm the queue is empty
node tools/play.mjs smokey,great_escape,raiders_boulder 2 "2,6"   # spot-check bots still wrap
```

Estimated cost (fal list prices, see `docs/fal-assets.md`): wave-2 images 20 × $0.08 ≈ **$1.60**;
wave-2 models 20 × $0.455 ≈ **$9.10**; the 11 costume doubles ≈ **$16** (4 already have images, so ~$14.50);
4 leftover props ≈ **$1.80**. Full queue ≈ **$27** — about a quarter of the original $80–110 wishlist,
because animation/sound/music (the expensive rows) are separate passes.

## Reference-image spec (what makes a good image-to-3D input)

Every prompt in `tools/manifest.mjs` is wrapped by `STYLE` in `tools/gen.mjs`. Check each generated
image against this list before approving the 3D step; regenerate (`--force --only <id> --img-only`) if it fails:

- Whole object in frame with margin on all sides; nothing cropped, nothing occluded.
- Three-quarter view from slightly above (vehicles/props) or straight-on A-pose (performers:
  arms ~40° from body, hands open, head-to-feet visible — Meshy auto-rig needs this).
- Plain flat light-grey background, soft even light, **no cast shadow** (shadows bake into textures).
- No people, no text, no logos. Performers must be anonymous doubles (no actor likeness — see the
  re-prompt note in `docs/fal-assets.md`).
- One object per image. Sets that articulate (drawbridge leaf) are generated as **one rigid piece**;
  the hinge motion stays in code (`s.box` pivot today, model on the same pivot after the swap).

Already on disk and approved against this spec: `ch_cop`, `ch_bride`, `ch_silent`, `ch_keaton`,
`fire_hydrant`, `fruit_cart` (images in `assets-src/img/` — only the 3D step is missing).

## The queue

| id | what | lands in | wiring after generation |
|---|---|---|---|
| `ch_cop` `ch_bride` `ch_silent` `ch_keaton` `ch_thug` `ch_hk` `ch_pilot` `ch_roadwarrior` `ch_skier` `ch_suit` `ch_hammer` | 11 rigged costume doubles | every stunt already requests these ids (`CHAR_FALLBACK` in `src/core/assets.js` substitutes today) | none — fallback stops applying automatically |
| `fire_hydrant` `fruit_cart` `cardboard_boxes` `bulldozer` | 4 leftover props | `french_connection`, `italian_job` (+ street dressing anywhere) | none for the first three (procedural stand-ins retire); bulldozer needs a `s.put` where wanted |
| `sp_*` (12) | cut-out tree/crowd sprites | `Stage.sprites()` already supports them | swap `s.forest('tree:pine', …)` → `s.forest('sp_pine', …)` per set, taste-driven |
| `set_drawbridge` | bascule bridge leaf | `blues_brothers` | replace the deck boxes on the existing pivot; keep solids |
| `set_clock_tower` | courthouse clock tower | `bttf` | hero backdrop piece behind the square; clock face stays code-timed |
| `set_dam_face` | arch dam wall | `goldeneye_dam` | swap the textured dam boxes; keep the bungee anchor points |
| `set_burj_spire` | supertall spire section | `mi_burj` | cap piece above the climb range |
| `set_boulder` | 5 m round boulder | `raiders_boulder` | swap the sphere; same radius/roll code |
| `set_stone_door` | carved temple door | `temple_door`, `raiders_boulder` | skin on the existing slab solid |
| `set_broken_bridge` | twisted broken bridge | `golden_gun` | visual swap over the existing ramps/solids |
| `set_a400_door` | A400M paratroop door section | `mi_a400` | dress the grip anchor; grab handles align with the hang pose |
| `set_overpass` | highway overpass ramp | `dark_knight` | set dressing over the flip zone |
| `set_ramp_truck` | stunt ramp truck | `fall_guy` | visual swap; ramp solids unchanged |
| `set_scaffold` | bamboo scaffold tower | `rumble_bronx` / HK sets | dressing + climb visual |
| `set_mall_atrium` | mall glass dome + pole | `police_story` | the pole is the slide visual; keep the slide path in code |
| `prop_crate_stack` `prop_barrels` `prop_market_stall` `prop_barrier` `prop_hay_bales` `prop_cones` `prop_stunt_ramp` `prop_cable_reel` | street/set clutter | any set via `s.put` / `s.forest` | add `MODEL_META` lengths (below) then place |

## After generation: the 10-minute checklist

1. `node tools/sheet.mjs` (or `viewer.html?models=<ids>`) — check each model's front faces the red arrow (-Z);
   if not, add a `MODEL_YAW` entry in `src/core/assets.js` (same as wave 1).
2. Add real-world lengths to `MODEL_META` for any new id used with `len` (props above are placed by `height`, so optional).
3. Performers: open `viewer.html?char=<id>` and confirm the full pose sheet deforms cleanly (shoulders/hips are
   where bad auto-rigs show). A bad rig is a regenerate, not a code fix.
4. Run the bot trio above plus one stunt per swapped set piece; screenshot before/after with `TAG=`.
5. Delete nothing: `assets-src/img/` + `assets-src/raw/` are the resumable source of truth.

## What this pack deliberately does not include

Motion-captured animation clips, recorded sound/voice and composed music (rows 2, 4, 5 of
`docs/fal-assets.md`) need pipeline additions (a Meshy multi-animation pass, an audio step), not just
manifest rows. The procedural animation system (`src/world/character.js` — poses, cycles, two-bone IK,
reach-to-grab) is the runtime those clips would layer onto; write that pass when it is funded.
