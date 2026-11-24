import { W, H, TICK } from './game/constants';
import { angleDiff, lineOfSight } from './game/collision';
import type { Player, PlayerInput, World } from './game/world';

const BLOCK_DEFAULT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Slash', 'Quote', 'Tab']);

export class Keyboard {
  private down = new Set<string>();
  private pressed = new Set<string>();
  mouseX = W / 2;
  mouseY = H / 2;
  mouseDown = false;
  wheel = 0;
  /** Chỉ chặn hành vi mặc định của trình duyệt khi đang trong trận. */
  gameActive = false;

  constructor(canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (!this.gameActive) return;
      if (BLOCK_DEFAULT.has(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.clear());
    canvas.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouseX = ((e.clientX - r.left) / r.width) * W;
      this.mouseY = ((e.clientY - r.top) / r.height) * H;
    });
    canvas.addEventListener('mousedown', (e) => { if (e.button === 0) this.mouseDown = true; });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) this.mouseDown = false; });
    canvas.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  isDown(...codes: string[]) { return codes.some((c) => this.down.has(c)); }
  wasPressed(...codes: string[]) { return codes.some((c) => this.pressed.has(c)); }
  axis(neg: string, pos: string) { return (this.isDown(pos) ? 1 : 0) - (this.isDown(neg) ? 1 : 0); }

  /** Gọi sau mỗi tick mô phỏng: phím "vừa nhấn" chỉ được dùng 1 lần. */
  endTick() { this.pressed.clear(); this.wheel = 0; }
  clear() { this.down.clear(); this.pressed.clear(); this.mouseDown = false; this.wheel = 0; }
}

/** Chế độ đấu Bot: WASD + chuột. */
export function mouseInput(kb: Keyboard, me: Player): PlayerInput {
  let weapon: number | null = null;
  for (let i = 0; i < 5; i++) if (kb.wasPressed(`Digit${i + 1}`)) weapon = i;
  return {
    mx: kb.axis('KeyA', 'KeyD'),
    my: kb.axis('KeyW', 'KeyS'),
    aim: Math.atan2(kb.mouseY - me.y, kb.mouseX - me.x),
    shoot: kb.mouseDown || kb.isDown('Space'),
    reload: kb.wasPressed('KeyR'),
    dash: kb.wasPressed('ShiftLeft', 'ShiftRight'),
    weapon,
    cycle: kb.wasPressed('KeyQ') || kb.wheel !== 0,
  };
}

export interface KeyScheme {
  up: string; down: string; left: string; right: string;
  shoot: string[]; dash: string[]; reload: string[]; cycle: string[];
}

export const P1_KEYS: KeyScheme = {
  up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD',
  shoot: ['KeyF', 'Space'], dash: ['KeyG'], reload: ['KeyR'], cycle: ['KeyQ'],
};

export const P2_KEYS: KeyScheme = {
  up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
  shoot: ['Period', 'Numpad0'], dash: ['Slash', 'Numpad1'], reload: ['Comma', 'Numpad2'], cycle: ['KeyL', 'Numpad3'],
};

/** Ngắm bằng bàn phím: nòng xoay theo hướng di chuyển, có hỗ trợ ngắm khi gần trúng đối thủ. */
export class KeyboardAim {
  private angle = 0;
  private roundId = -1;

  update(mx: number, my: number, me: Player, enemy: Player, world: World): number {
    if (world.roundId !== this.roundId) { this.roundId = world.roundId; this.angle = me.aim; }
    if (mx || my) {
      const d = angleDiff(Math.atan2(my, mx), this.angle);
      const step = 14 * TICK;
      this.angle += Math.max(-step, Math.min(step, d));
    }
    const toE = Math.atan2(enemy.y - me.y, enemy.x - me.x);
    if (enemy.alive && Math.abs(angleDiff(toE, this.angle)) < 0.35 &&
        lineOfSight(me.x, me.y, enemy.x, enemy.y, world.map.walls)) {
      return toE;
    }
    return this.angle;
  }
}

export function keyboardInput(kb: Keyboard, k: KeyScheme, aim: KeyboardAim, me: Player, enemy: Player, world: World): PlayerInput {
  const mx = kb.axis(k.left, k.right);
  const my = kb.axis(k.up, k.down);
  return {
    mx, my,
    aim: aim.update(mx, my, me, enemy, world),
    shoot: kb.isDown(...k.shoot),
    reload: kb.wasPressed(...k.reload),
    dash: kb.wasPressed(...k.dash),
    weapon: null,
    cycle: kb.wasPressed(...k.cycle),
  };
}
