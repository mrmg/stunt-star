// Keyboard + gamepad input with edge detection.
const MAP = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  Space: 'a', KeyJ: 'a', ShiftLeft: 'b', ShiftRight: 'b', KeyK: 'b', KeyE: 'x', KeyL: 'x', KeyQ: 'y', KeyV: 'v', Enter: 'start', Escape: 'pause', KeyR: 'retry',
};
export class Input {
  constructor() {
    this.down = {}; this.pressed = {}; this.released = {}; this._q = []; this.enabled = true; this.auto = null;
    addEventListener('keydown', e => { const k = MAP[e.code]; if (k) { if (!e.repeat) this._q.push([k, true]); if (e.code !== 'Escape' && !e.target.closest?.('input')) e.preventDefault(); } });
    addEventListener('keyup', e => { const k = MAP[e.code]; if (k) this._q.push([k, false]); });
    addEventListener('blur', () => { for (const k in this.down) if (this.down[k]) this._q.push([k, false]); });
  }
  poll() {
    this.pressed = {}; this.released = {};
    for (const [k, d] of this._q) { if (d && !this.down[k]) this.pressed[k] = true; if (!d && this.down[k]) this.released[k] = true; this.down[k] = d; }
    this._q.length = 0;
    const gp = navigator.getGamepads?.()[0];
    let gx = 0, gy = 0;
    if (gp) {
      gx = Math.abs(gp.axes[0]) > 0.18 ? gp.axes[0] : 0; gy = Math.abs(gp.axes[1]) > 0.18 ? gp.axes[1] : 0;
      const b = (i, k) => { const d = !!gp.buttons[i]?.pressed, was = !!this._gp?.[k]; if (d && !was) this.pressed[k] = true; if (!d && was) this.released[k] = true; (this._gp ??= {})[k] = d; };
      b(0, 'a'); b(1, 'b'); b(2, 'x'); b(3, 'y'); b(9, 'start'); b(7, 'rt'); b(6, 'lt');
    }
    const g = this._gp || {};
    const d = this.enabled ? this.down : {};
    this.x = Math.max(-1, Math.min(1, (d.right ? 1 : 0) - (d.left ? 1 : 0) + gx));
    this.y = Math.max(-1, Math.min(1, (d.up ? 1 : 0) - (d.down ? 1 : 0) - gy + (g.rt ? 1 : 0) - (g.lt ? 1 : 0)));
    this.a = this.enabled && !!(d.a || g.a); this.b = this.enabled && !!(d.b || g.b); this.xk = this.enabled && !!(d.x || g.x);
    if (!this.enabled) { const keep = { start: this.pressed.start, pause: this.pressed.pause, retry: this.pressed.retry, a: this.pressed.a, v: this.pressed.v }; this.pressed = keep; }
    if (this.auto) { this.press = k => { this.pressed[k] = true; }; this.auto(this); }
  }
  hit(k) { return !!this.pressed[k]; }
}
