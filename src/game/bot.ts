import { TICK, PLAYER_R } from './constants';
import { angleDiff, clamp, lineOfSight, segmentRect } from './collision';
import { NavGrid } from './nav';
import { MAX_ARMOR } from './pickups';
import { NO_INPUT, type PlayerInput, type Player, type Side, type World } from './world';

export type Difficulty = 'easy' | 'normal' | 'hard';

export const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: 'Dễ', normal: 'Thường', hard: 'Khó' };

const PARAMS: Record<Difficulty, { aimErr: number; reaction: number; turn: number; lead: number; dashChance: number }> = {
  easy:   { aimErr: 0.22, reaction: 0.5,  turn: 5,  lead: 0,   dashChance: 0.002 },
  normal: { aimErr: 0.1,  reaction: 0.3,  turn: 9,  lead: 0.6, dashChance: 0.006 },
  hard:   { aimErr: 0.04, reaction: 0.15, turn: 16, lead: 1,   dashChance: 0.012 },
};

export class Bot {
  private aim = 0;
  private seenT = 0;
  private strafe = 1;
  private strafeT = 0;
  private switchCd = 0;
  private t = Math.random() * 100;
  private prevEnemy = { x: 0, y: 0 };
  private roundId = -1;
  private nav: NavGrid | null = null;
  private field: Int32Array | null = null;
  private fieldT = 0;
  private fieldKey = '';

  constructor(public readonly id: Side, public readonly difficulty: Difficulty) {}

  think(world: World): PlayerInput {
    const dt = TICK;
    const P = PARAMS[this.difficulty];
    const me = world.players[this.id], en = world.players[1 - this.id];
    const nav = (this.nav ??= new NavGrid(world.map));
    this.t += dt;

    if (world.roundId !== this.roundId) {
      this.roundId = world.roundId;
      this.aim = me.aim;
      this.prevEnemy = { x: en.x, y: en.y };
      this.seenT = 0;
      this.field = null;
    }

    const inp: PlayerInput = { ...NO_INPUT };
    let evx = (en.x - this.prevEnemy.x) / dt, evy = (en.y - this.prevEnemy.y) / dt;
    if (Math.hypot(evx, evy) > 1500) { evx = 0; evy = 0; }
    this.prevEnemy = { x: en.x, y: en.y };

    const dx = en.x - me.x, dy = en.y - me.y, dist = Math.hypot(dx, dy);
    const los = en.alive && lineOfSight(me.x, me.y, en.x, en.y, world.map.walls);
    this.seenT = los ? this.seenT + dt : 0;

    // Chọn súng theo khoảng cách
    this.switchCd -= dt;
    const want = me.weapons.findIndex((w) => w.id === (dist < 230 ? 'shotgun' : dist < 520 ? 'smg' : 'pistol'));
    if (want >= 0 && want !== me.weapon && this.switchCd <= 0 && me.fireCd <= 0.05) {
      inp.weapon = want;
      this.switchCd = 1.5;
    }

    // Ngắm: đón đầu + sai số dao động
    const def = me.def;
    const lead = (dist / def.bulletSpeed) * P.lead;
    const tx = en.x + evx * lead, ty = en.y + evy * lead;
    const noise = Math.sin(this.t * 2.3) * 0.6 + Math.sin(this.t * 5.1 + 1) * 0.4;
    const desired = Math.atan2(ty - me.y, tx - me.x) + noise * P.aimErr;
    const diff = angleDiff(desired, this.aim);
    this.aim += clamp(diff, -P.turn * dt, P.turn * dt);
    inp.aim = this.aim;

    if (los && this.seenT > P.reaction && Math.abs(diff) < 0.25 && dist < def.range * 0.95) inp.shoot = true;

    const ammo = me.ammo[me.weapon];
    if (ammo === 0 || (!los && ammo < def.mag * 0.6)) inp.reload = true;

    // Di chuyển
    if (world.phase === 'playing') {
      let angle: number | null;
      if (los) {
        this.strafeT -= dt;
        if (this.strafeT <= 0) { this.strafe *= -1; this.strafeT = 0.5 + Math.random(); }
        const toE = Math.atan2(dy, dx);
        const prefer = me.def.id === 'shotgun' ? 140 : me.def.id === 'smg' ? 320 : 480;
        let radial = dist > prefer + 60 ? 1 : dist < prefer - 60 ? -1 : 0;
        if (me.reloading) radial = -1;
        const mvx = Math.cos(toE + Math.PI / 2) * this.strafe + Math.cos(toE) * radial * 0.8;
        const mvy = Math.sin(toE + Math.PI / 2) * this.strafe + Math.sin(toE) * radial * 0.8;
        angle = this.steer(me, Math.atan2(mvy, mvx), world);
      } else {
        // Không thấy đối thủ: ưu tiên nhặt vật phẩm hữu ích ở gần, nếu không thì đi tìm đối thủ
        const goal = this.pickGoal(me, world) ?? en;
        const key = `${Math.round(goal.x)},${Math.round(goal.y)}`;
        this.fieldT -= dt;
        if (!this.field || this.fieldT <= 0 || key !== this.fieldKey) {
          this.field = nav.field(goal.x, goal.y);
          this.fieldT = 0.3;
          this.fieldKey = key;
        }
        angle = nav.direction(this.field, me.x, me.y);
      }
      if (angle !== null) { inp.mx = Math.cos(angle); inp.my = Math.sin(angle); }
      if (los && me.dashCd <= 0 && Math.random() < P.dashChance) inp.dash = true;
    }
    return inp;
  }

  private pickGoal(me: Player, world: World): { x: number; y: number } | null {
    let best: { x: number; y: number } | null = null, bestD = 450;
    for (const k of world.pickups) {
      const useful =
        k.kind === 'health' ? me.hp < 80 :
        k.kind === 'armor' ? me.armor < MAX_ARMOR :
        k.kind === 'ammo' ? me.ammo[me.weapon] < me.def.mag : true;
      const d = Math.hypot(k.x - me.x, k.y - me.y);
      if (useful && d < bestD) { bestD = d; best = k; }
    }
    return best;
  }

  /** Thử lệch hướng nếu phía trước có tường; đổi hướng né khi bị chặn. */
  private steer(me: Player, angle: number, world: World): number {
    const offsets = [0, 0.5, -0.5, 1, -1, 1.6, -1.6, Math.PI];
    for (const o of offsets) {
      const a = angle + o * this.strafe;
      if (this.clear(me, a, 48, world)) {
        if (Math.abs(o) >= 1.6) this.strafe *= -1;
        return a;
      }
    }
    return angle;
  }

  private clear(me: Player, a: number, len: number, world: World): boolean {
    const px = Math.cos(a + Math.PI / 2), py = Math.sin(a + Math.PI / 2);
    for (const off of [-PLAYER_R + 2, 0, PLAYER_R - 2]) {
      const sx = me.x + px * off, sy = me.y + py * off;
      const ex = sx + Math.cos(a) * len, ey = sy + Math.sin(a) * len;
      for (const w of world.map.walls) if (segmentRect(sx, sy, ex, ey, w) !== null) return false;
    }
    return true;
  }
}
