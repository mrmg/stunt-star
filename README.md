# STUNT STAR

A Three.js stunt-performer career game: 61 homages to famous film stunts, from silent-era falls to modern aerial work.
The director briefs you, the slate claps, ACTION — then you are paid on how well the take went, minus agent fees and medical bills.

## Run
```
npm install
npm run dev        # http://localhost:5173
npm run build      # static build in dist/
```
Keyboard: WASD / arrows, SPACE, SHIFT, E, R (retake), ESC (pause). A gamepad also works.
Dev URLs: `?unlock=1` (all tiers open), `?stunt=<id>` (jump to a stunt), `&auto=1` (skip briefing), `&bot=1&speed=3` (autopilot).

## Layout
- `src/core` renderer + film post-processing, input, procedural audio, particles, asset loading
- `src/world` stage toolkit (sky, backdrops, set pieces, camera) and the rig-agnostic procedural character animator
- `src/modes` gameplay controllers: drive, run, fall, grip, fly, fight
- `src/stunts` the stunts (see `docs/authoring.md` for how to write one)
- `src/game` career economy and UI
- `tools/` asset pipeline (`gen.mjs` + `manifest.mjs`, needs FAL_KEY in `.env`), bot playtester (`play.mjs`), screenshot helpers

## Assets
Vehicles, performers, props, backdrops and textures were generated with fal.ai (image → 3D, rigged with Meshy) and optimised with glTF-Transform.
`node tools/missing.mjs` lists manifest entries that have not been generated yet; `node tools/gen.mjs` fills them in (it skips anything already on disk).
Performers are anonymous stunt doubles in costume, not actor likenesses.
