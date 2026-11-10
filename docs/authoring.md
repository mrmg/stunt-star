# Stunt authoring guide (StuntStar)

Three.js game. Each stunt is a plain object in `src/stunts/<file>.js` (default export = array). Read these first:
`src/stunts/drive1.js` (9 finished examples incl. bots), `src/stunts/common.js`, `src/world/stage.js`, and the mode you use in `src/modes/`.

## World conventions
- Travel direction is **-Z**. +X is screen-right, +Y up. Units metres, seconds. Headings: `rotation.y`, forward = (-sin h, 0, -cos h).
- Ground comes from `s.course.height(x,z,yRef)`: `course.base` (default y=0; `s.terrain()` overrides inside its rect) plus "pieces" (ramps, decks, rooftops) whose top is within reach.
- Collisions are AABB "solids": `type:'solid'` (crash/scrape), `'break'` (smash through; `soft`, `glass`, `debris`, `slow`, `on`), `'trigger'` (`on(mode, sol)` fires once).
- Models come normalised: front faces -Z, sitting on y=0, scaled to real length.

## Stunt object
```js
{ id, title, film, year, tier: 1..6, pay, mode: 'drive'|'run'|'fall'|'grip'|'fly'|'fight'|'custom',
  art: 'bd_xxx' (menu card image), music: 'tension|spy|chase|western|silent|kungfu|synth|epic',
  role: 'one line', brief: 'director quote', tips: ['3 short html tips'], controls: CTL.xxx or html,
  intro: { r, h, speed, a0, up, fov }  // briefing orbit camera around s.focus (or s.introFocus)
  assets: { models: [...], tex: [...] },  // EVERYTHING you use must be listed (backdrops + tx_ textures go in tex)
  build(s) { ... },                       // build set, create the mode, wire scoring
  bot(s, inp, B) { ... } }                // autopilot for tests: set inp.x, inp.y (-1..1), inp.a/inp.b/inp.xk (held), inp.press('a'|'b'|'x'|'up'|'down'|'left'|'right') for edge presses. B = scratch object.
```
Pay guide: tier1 1.5–2.6k, tier2 3–5k, tier3 6–9k, tier4 11–16k, tier5 20–30k, tier6 40–70k.
Input mapping: `inp.x` A/D, `inp.y` W/S, `inp.a` SPACE, `inp.b` SHIFT, `inp.xk` E; edges via `inp.hit('a')`, `inp.hit('x')`, `inp.hit('up')` etc.

## Stage API (`s`)
- Env: `s.env(preset, {backdrop:'bd_x', look:'neutral|warm60s|teal_orange|matrix|wasteland|cold|night|neon|silent|noir|bleach|golden|jungle|vhs80s', fog, hz, amb, sunI, shadows, lookOver:{...}})`. Presets: day noon golden dusk night overcast storm desert snow jungle indoor cave high. `silent`/`noir` looks are black & white.
- Ground: `s.ground({tex,tile,y,color,base})`, `s.water({y,color,w,d,z})`, `s.terrain({x0,x1,z0,z1,res,fn:(x,z)=>y,tex,tile,base})`.
- Geometry: `s.box({x,y(base),z,w,h,d,mat,tile,solid,sol:{msg,on,hardK},top:true(walkable),parent,cast})`, `s.cyl`, `s.slope({x,w,z0,z1,y0,y1,curve,thick,mat})`, `s.ramp({x,z,w,len,h})`, `s.deck({x,w,z0,z1,y,thick})`, `s.road({z0,z1,width,lanes,path:z=>x,mat,marks})`, `s.building({x,z,w,d,h,fac,lit,top,parapet,y})`, `s.row({side,x,z0,z1,fac:[],height:[a,b],lit,yfn,solid})`.
- Materials: `s.mat({tex,rep,color,rough,metal,emissive,emI,opacity,glass,paint,side})` or pass the same object/texture id as `mat:`.
- Props: `s.put(modelId,{x,y,z,ry,len|height,solid,sol,parent,onGround})`, `s.forest('tree:pine|oak|palm|bush|cypress|jungle|dead|snowpine' or modelId, n, (rand,i)=>[x,z], {h:[a,b],solid,seedv})`, `s.char(id,{x,y,z,heading,parent,pose})`, `s.crew({x,y,z,ry,people})` (camera+light+chair: put one near the start so it feels like a film set), `s.cones`, `s.light({x,y,z,color,i,dist})`, `s.mark({x,z,r,color})`, `s.line({x,z,w,d,color,y})`.
- common.js: `street(s,{z0,z1,width,lanes,fac,height,lit,lamps,yfn})`, `traffic(s,movers,{lanes:[[x,dir]],n,z0,z1,speed,zEnd})`, `sign(s,text,{x,y,z,w,ry,bg,fg})`, `tumbleScript(s,car,{rollRate,pitchRate,decel,onDone})`, `botDrive(car,inp,targetX,targetSpeed)`, `CTL`, `K('W')`, `TRAFFIC`.
- FX: `s.fx.dust|smokePuff|sparks|fireBurst|explosion|flame|splash|spray|glass|debris|streak|cloudPuff|light`, `s.engine.addShake(a)`, `.flash(a)`, `.hurt(a)`, `s.slowmo(scale,dur)`. Audio: `s.audio.impact|crash|glass|explosion|thud|punch|whoosh|splash|thunder|gun|horn|bell|tick|good|bad()`, loops `s.audio.set(name,'engine|jet|wind|skid|rotor|water|rumble|rain',pitch,vol)`.
- Flow: `s.onUpdate((dt,t)=>{})`, `s.after(sec,fn)`, `s.started` (false during briefing — nothing should move until true), `s.t0` time ACTION was called, `s.ended`.
- HUD: `s.objective(text)`, `s.msg(text,'good|bad|small|huge')`, `s.hud.readout(id,label,value,'ok|warn')`, `s.hud.meter(id,label,0..1,{color,zone})`, `s.hud.prompt(html)`, `s.hud.bar(v,[a,b],[pa,pb])` timing bar / `hideBar()`.
- Scoring: `s.rate(label, 0..1, weight)` (re-rating a label replaces it), `s.bonus(label, dollars)`, then `s.wrap(delay, note?)` for success or `s.fail(reason, {injury:0..1})`. Helpers from stage.js: `near(value,target,perfectWithin,zeroAt)`, `clamp, lerp, damp, smooth, rnd, sr/srand, V3`.
- Camera: modes set it up; override with `s.cam.follow(()=>({pos,heading}),{dist,height,side,ahead,up,stiff,fov,yaw,ground:false})`, `s.cam.fixed(posVec3, targetFn,{fov})`, `s.cam.set({...})`.

## Modes
- `new Drive(s,{kind:'car|muscle|mini|super|bike|bus|truck|tank|boat|ski|sled', model, x,z,y, driver:'ch_x', driverPos, cam, top,accel,grip,nose,air,hard,pitchTol,...})` → `.pos .v(m/s) .mph .kmh .heading .grounded .pitch .roll .stats`, hooks `onAir(t) onLand(info{clean,impact,airTime,dist,drop,rolls}) onHit(sol,imp) onSmash(sol)`, `.crash(reason,{injury})`, `.frozen .control .throttleLock .steerScale .boost .rollOverride .pitchOverride .twist .dustColor`. `Movers(s,car).add({model|obj,x|path,z,v,y,ai,solid,msg})`, `.fling(e)`. `Convoy(s,car,[{model}],{delay,gap})`.
- `new Run(s,{char,x,z,y,speed,sprint,strafe,jumpV,grav,slideT,fallDeath,mirror,cam,xmin,xmax,grab})` → `.pos .v .grounded .slide .stats`, hooks `onJump onSlide onLand(info{drop,dist}) onGrab onHit(sol) onStumble`, `.stumble() .die(reason,injury) .frozen .control .speedK`. W sprint, A/D strafe, SPACE jump, S/SHIFT slide; ledge-grab saves short jumps.
- `new Fall(s,{char,x,y,z,vy0,spread,tuck,steer,chuteV,view:'chase|top|side',clouds,groundY,pose,cam})` → `.pos .vel .alt .tucked .chute`, `deploy(modelId)`, `addBody(char,{x,y,z,vy,ai})`, hooks `onLand(info{speed,chute}) onHit onDeploy`. SPACE tuck/dive, E is yours to bind (`inp.hit('x')`).
- `new Grip(s,{char,anchor:Object3D,offset:[x,y,z],plane:'xy|xz|zy',range:{u:[a,b],v:[a,b]},speed,pose,movePose,bracePose,idleCycle,heading})` → `.u .v .grip .stam .braced .stats`, `gust(inSec,{power,label,dur,on,onHit})` telegraphed hits the player must brace (hold SPACE), `hazard({u,v,vu,vv,r,power,obj})`, `onFall`, `.done=true` to stop.
- `new Fly(s,{model,kind:'jet|heli|prop',x,y,z,speed,boost,agility,climb,r,canInvert,floor:(x,z)=>y,ceil,walls:(z,y)=>[xmin,xmax],cam})` → `.pos .v .clear{floor,ceil,left,right} .inverted .stats`, `crash(reason)`, `onHit`.
- `new Fight(s,{char,enemies:['ch_goon'],beats:chart('L R . U D B', {bpm,start,sub}),hp,travel,camDist,spawn,onHit,onMiss})` → `.score() {acc,combo,hp}`, `onDone`. Beat dirs: L R (A/D strike), U (W kick), D (S duck), B (SPACE block).
- Custom: write your own update with `s.onUpdate`, `s.char`, `s.cam`.
- Characters: `c.setPose(name|poseObj, blendSec)`, `c.setCycle('run|walk|climb|flail|swim|idle|guard|hang|cheer', rate)`, `c.heading`, `c.root.position`, `c.tumble(x,y,z)`. Pose names are in `src/world/character.js` (POSES). Pose object fields: hip[y,pitch,yaw,roll] sp hd body[pitch,roll,yaw] aR aL lR lL as [out,up,fwd, out,up,fwd] (upper, lower limb directions).

## Assets available (nothing else can be generated — the image/3D budget is spent)
Vehicles: a400m acrostar bluesmobile bmw_bike bmw_m5 challenger_white charger_black charger_dom city_bus cv2 db5 dbs delorean ducati eleanor enduro_bike f14 fa18 fatboy general_lee helicopter hornet jeep_gc joker_truck learjet lemans lykan mach1 mig mini_blue mini_red mini_white mustang_green peugeot406 police_car rocket_car sedan_grey semi_truck snowmobile speedboat steam_loco supra t55_tank tanker taxi thunderbird transam triumph van_white wagon_brown wrx ww2_truck mine_cart raft
Characters (rigged): ch_stunt ch_adventurer ch_spy ch_agent ch_coat ch_kungfu ch_biker ch_skydiver ch_goon. These ids fall back automatically: ch_cop→agent ch_bride→stunt ch_silent/ch_keaton/ch_suit/ch_hammer→spy ch_thug→goon ch_hk→agent ch_pilot/ch_skier→skydiver ch_roadwarrior→biker (use the intended id so a later asset drop upgrades it).
Props: airbag camera_crew clock_tower_face crocodile director_chair film_light golden_idol parachute parachute_uj rock_desert rock_grey saguaro stone_idol_head street_lamp (NOT available: fruit_cart cardboard_boxes fire_hydrant bulldozer — build from boxes instead). Trees: use `s.forest('tree:…')`.
Backdrops (`tex`): bd_abudhabi bd_alps bd_bayou bd_beach bd_brooklyn bd_canyon bd_canyon_snow bd_chicago bd_clouds bd_dam bd_desert_mtn bd_dubai bd_egypt bd_georgia bd_gotham bd_hk bd_india bd_jungle bd_kl bd_la bd_miami bd_monument bd_norway bd_nyc_night bd_ocean bd_old_la bd_paris bd_rio bd_river_gorge bd_rotterdam bd_sf bd_smalltown bd_snow bd_storm bd_stpetersburg bd_thai bd_tokyo bd_turin bd_vegas bd_wasteland
Textures: tx_asphalt tx_brick tx_cave tx_cobble tx_concrete tx_dirt tx_grass tx_jungle_floor tx_metal tx_redrock tx_rock tx_roof tx_sand tx_snow tx_temple tx_wallpaper tx_hotel tx_water tx_wood tx_glass_tower; facades tx_fac_hk tx_fac_italy tx_fac_mall tx_fac_night tx_fac_nyc tx_fac_office tx_fac_old tx_fac_paris tx_fac_russia tx_fac_sf

## Testing (dev server already running on http://localhost:5173 — do not start another)
- `node tools/play.mjs <id>[,<id>] 3 "3,8"` runs the stunt with its bot at 3× speed, saves `shots/<id>_0.jpg`, `_1.jpg`, `_end.jpg`, prints result + JS errors. Run ONE browser at a time (the machine is low on memory) and never in the background.
- `node tools/eval.mjs "?stunt=<id>&auto=1" "<js expression>" 3000` evaluates in the page (`window.__game.stage`).
- Look at the screenshots (Read tool) — sparingly, 1–2 per stunt — to check the set reads as the film and the performer/vehicle faces the right way.
- Done means: no JS errors, the bot wraps the stunt with quality ≥ 0.7, and a careless player can fail it.
