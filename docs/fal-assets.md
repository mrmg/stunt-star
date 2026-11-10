# What was generated on fal.ai (and what more budget would buy)

Spend is estimated from fal's published list prices and the generation logs. The API key can't read billing, so treat these as close estimates, not an invoice.
The balance ran out at 22:18 on 9 Nov 2026, part-way through the character and prop batch.

## The pipeline
1. **Reference image:** `fal-ai/nano-banana-2` makes a studio photo on a plain grey background ($0.08 per image).
2. **Image to 3D:**
   - vehicles and props: `fal-ai/hunyuan-3d/v3.1/pro/image-to-3d` with PBR materials (~$0.375 per model);
   - performers: `meshy/v7.1/image-to-3d` with textures and auto-rigging to a humanoid skeleton (~$1.40 per model).
3. **Optimise:** glTF-Transform simplifies the meshes, resizes textures to 1024 px and converts them to WebP.
   It runs locally and is free. A typical model goes from ~40 MB raw to ~1 MB.

## Generated and in the game

| Kind | Count | Model | Est. cost |
|---|---|---|---|
| Vehicles (cars, bikes, trucks, tank, aircraft, boat, train…) | 54 / 54 | image + Hunyuan 3D | 54 × $0.455 ≈ **$24.60** |
| Props (camera crew kit, airbag, idol, crocodile, parachutes, clock face, rocks, lamps…) | 17 / 21 | image + Hunyuan 3D | 17 × $0.455 ≈ **$7.70** |
| Rigged performers (stunt double, adventurer, spy, agent, hacker, kung-fu, biker, skydiver, henchman) | 9 / 20 | image + Meshy (rigged) | 10 × $1.48 ≈ **$14.80** (includes one regeneration) |
| Panoramic location backdrops (Turin, San Francisco, Las Vegas, Gotham, Dubai, canyons…) | 40 / 40 | image only | 40 × $0.08 = **$3.20** |
| Tiling textures and building facades | 30 / 30 | image only | 30 × $0.08 = **$2.40** |
| Prompt retries: the adventurer first came out looking like the real actor, so all performers were re-prompted as anonymous doubles | ~13 images | image only | **~$1.00** |
| Character images made before the money ran out (no 3D yet): cop, bride, silent-film comic ×2 | 4 | image only | **$0.32** |
| **Total** | | | **≈ $54** |

**Not generated** because the balance ran out:
- 11 costume doubles: cop, bride, silent ×2, thug, HK cop, pilot, road warrior, skier, suit, wild-hair. The game substitutes the closest rigged performer.
- 4 props: fire hydrant, fruit cart, cardboard boxes, bulldozer. These are built from boxes instead.
- 12 cut-out tree and crowd sprites. Procedural instanced trees are used instead.

## If there were more budget: what I'd buy, in order of impact

| # | What | Why it matters | Est. cost |
|---|---|---|---|
| 1 | **The 11 missing costume doubles** (rigged). Biggest quality gap. | Right now the Bride's yellow jumpsuit, Keaton's porkpie hat and the Fury Road war boy are stand-ins. Performers are what make a stunt read as "that film". | ~$16 |
| 2 | **Motion-captured animation clips** via `fal-ai/meshy/rigging/multi-animation`, run once per character. Meshy's library has runs, sprints, parkour vaults, rolls, falls, ledge hangs, climbs, punches, kicks, hit reactions and knock-downs. | Replaces the hand-posed procedural animation, which is the least "AAA" thing on screen in the foot, fight and hang stunts. | 20 characters × ~10 clips ≈ $16–25 |
| 3 | **Hero set pieces** for the most famous stunts: drawbridge leaves, the BTTF courthouse clock tower, the Dark Knight overpass, the Burj spire, the A400M door section, the Golden Gun broken bridge, the Temple of Doom stone door, the boulder, the dam face. Plus street dressing: crates, barrels, market stalls, barriers, hay bales, cones, stunt ramps. | Sets are mostly textured boxes today; a handful of real landmark models does more for "you can tell which movie it is" than anything else. | ~40 × $0.455 ≈ $18 |
| 4 | **Sound** via `elevenlabs/sound-effects` and `elevenlabs/tts`: real engines (V8, Mini, Harley, jet, rotor), tyre squeal, glass, crashes, explosions, crowd, plus a recorded director voice (≈150 lines: "Action!", "Cut!", per-stunt notes). | Audio is fully synthesised today and the director voice relies on whatever voice the player's browser has. | SFX ~$5, voice ~$2–4 |
| 5 | **Music** via `elevenlabs/music` or `minimax-music`: about ten original genre cues (60s spy, 70s car chase, Hong Kong action, 80s synth, modern epic, Western, silent-film piano) with intensity stems. | Replaces the procedural sequencer. | ~$10–20 |
| 6 | **Menu card art**: one original "poster still" per stunt (61 images). | Today the cards reuse the location backdrops. | ~$5 |
| 7 | **PBR texture sets**: normal and roughness maps for the 30 tiling textures, plus 2K versions of the hero facades. | Closer-up shots in the new replays expose the flat textures. | ~$5 |
| 8 | Leftovers: the 12 sprite trees and crowds, the 4 missing props. | | ~$3 |

**Total wishlist ≈ $80–110.**
Items 1–3 (~$50) would make the biggest visible difference: right performers, real motion, landmark sets.
Everything is resumable. `node tools/missing.mjs` lists what's missing and `node tools/gen.mjs` fills only the gaps.
Items 2–7 need small additions to the pipeline (an animation pass, an audio step) that I can write when you're ready.
