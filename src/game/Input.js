export class Input {
  constructor() {
    this.down = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.mouse = { x: 0, y: 0 };
    window.addEventListener('keydown', (e) => {
      const code = e.code;
      if (!this.down.has(code)) this.pressed.add(code);
      this.down.add(code);
      if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Tab'].includes(code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this.released.add(e.code);
    });
    window.addEventListener('blur', () => this.down.clear());
  }
  held(code) { return this.down.has(code); }
  tap(code) { return this.pressed.has(code); }
  up(code) { return this.released.has(code); }
  endFrame() { this.pressed.clear(); this.released.clear(); }
}
