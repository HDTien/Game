import {
  TICK, PLAYER_R, PLAYER_SPEED, MAX_HP, DASH_DIST, DASH_TIME, DASH_CD, SWITCH_DELAY,
  ROUNDS_TO_WIN, MAX_ROUNDS, ROUND_TIME, COUNTDOWN, ROUND_END_DELAY, PLAYER_COLORS,
} from './constants';
import type { WeaponDef, WeaponId } from './weapons';
import type { GameMap, Point } from './map';
import { resolveCircleRect, segmentRect, segmentCircle } from './collision';
import {
  type PickupKind, PICKUP_R, PICKUP_FIRST, PICKUP_INTERVAL, MAX_PICKUPS, HEAL_AMOUNT, ARMOR_AMOUNT,
  MAX_ARMOR, BOOST_TIME, DAMAGE_MULT, SPEED_MULT, randomPickupKind,
} from './pickups';

/**
 * Mô phỏng trận đấu thuần logic (không DOM, không render).
 * Chỉ nhận input của 2 người chơi mỗi tick → có thể tái sử dụng cho chế độ online sau này.
 */

export type Side = 0 | 1;

export interface PlayerInput {
  mx: number;            // -1..1
  my: number;            // -1..1
  aim: number;           // radian
  shoot: boolean;        // giữ
  reload: boolean;       // nhấn (edge)
  dash: boolean;         // nhấn (edge)
  weapon: number | null; // chọn súng trực tiếp (chỉ số trong bộ súng)
  cycle: boolean;        // nhấn (edge) đổi súng kế tiếp
}

export const NO_INPUT: PlayerInput = {
  mx: 0, my: 0, aim: 0, shoot: false, reload: false, dash: false, weapon: null, cycle: false,
};

export interface PlayerStats {
  shots: number; hits: number; damage: number; kills: number; deaths: number;
  weaponKills: Partial<Record<WeaponId, number>>;
}

export class Player {
  x = 0; y = 0; vx = 0; vy = 0; aim = 0;
  hp = MAX_HP;
  armor = 0;
  alive = true;
  weapon = 0;
  ammo: number[];
  reloadT = 0;
  fireCd = 0;
  dashCd = 0;
  dashT = 0;
  dashDx = 0;
  dashDy = 0;
  damageBoostT = 0;
  speedBoostT = 0;
  hitFlash = 0;
  stats: PlayerStats = { shots: 0, hits: 0, damage: 0, kills: 0, deaths: 0, weaponKills: {} };

  constructor(
    public readonly id: Side,
    public name: string,
    public readonly color: string,
    public readonly weapons: WeaponDef[],
  ) {
    this.ammo = weapons.map((w) => w.mag);
  }

  get def(): WeaponDef { return this.weapons[this.weapon]; }
  get reloading(): boolean { return this.reloadT > 0; }

  reset(spawn: Point, aim: number) {
    this.x = spawn.x; this.y = spawn.y; this.vx = 0; this.vy = 0; this.aim = aim;
    this.hp = MAX_HP; this.armor = 0; this.alive = true; this.weapon = 0;
    this.ammo = this.weapons.map((w) => w.mag);
    this.reloadT = 0; this.fireCd = 0; this.dashCd = 0; this.dashT = 0; this.hitFlash = 0;
    this.damageBoostT = 0; this.speedBoostT = 0;
  }
}

export interface Bullet {
  x: number; y: number; vx: number; vy: number;
  owner: Side; damage: number; life: number; weapon: WeaponId; lifesteal: number;
}

export interface Pickup { id: number; kind: PickupKind; x: number; y: number; age: number }

export type Phase = 'countdown' | 'playing' | 'roundEnd' | 'matchEnd';

export type GameEvent =
  | { type: 'shoot'; owner: Side; weapon: WeaponId; x: number; y: number; angle: number }
  | { type: 'hit'; target: Side; x: number; y: number; damage: number; angle: number; armor: boolean }
  | { type: 'kill'; killer: Side; victim: Side; weapon: WeaponId; x: number; y: number }
  | { type: 'spark'; x: number; y: number }
  | { type: 'reload'; owner: Side }
  | { type: 'reloadDone'; owner: Side }
  | { type: 'switch'; owner: Side }
  | { type: 'dash'; owner: Side; x: number; y: number }
  | { type: 'pickupSpawn'; kind: PickupKind; x: number; y: number }
  | { type: 'pickup'; owner: Side; kind: PickupKind; x: number; y: number }
  | { type: 'countdown'; n: number }
  | { type: 'go' }
  | { type: 'roundEnd'; winner: Side | null; reason: 'kill' | 'time' }
  | { type: 'matchEnd'; winner: Side | null };

export interface RoundResult { winner: Side | null; duration: number; damageTaken: [number, number] }

export class World {
  readonly players: [Player, Player];
  bullets: Bullet[] = [];
  pickups: Pickup[] = [];
  events: GameEvent[] = [];
  phase: Phase = 'countdown';
  phaseT = 0;
  roundTime = ROUND_TIME;
  round = 1;
  /** Tăng mỗi lần bắt đầu round, để input/bot biết mà reset trạng thái. */
  roundId = 0;
  score: [number, number] = [0, 0];
  elapsed = 0;
  winner: Side | null = null;
  rounds: RoundResult[] = [];
  private lastCount = 0;
  private pickupT = 0;
  private pickupSeq = 0;
  private roundDamage: [number, number] = [0, 0];

  constructor(public readonly map: GameMap, names: [string, string], loadouts: [WeaponDef[], WeaponDef[]]) {
    this.players = [
      new Player(0, names[0], PLAYER_COLORS[0], loadouts[0]),
      new Player(1, names[1], PLAYER_COLORS[1], loadouts[1]),
    ];
    this.startRound();
  }

  private startRound() {
    const [s0, s1] = this.map.spawns;
    this.players[0].reset(s0, Math.atan2(s1.y - s0.y, s1.x - s0.x));
    this.players[1].reset(s1, Math.atan2(s0.y - s1.y, s0.x - s1.x));
    this.bullets = [];
    this.pickups = [];
    this.pickupT = PICKUP_FIRST;
    this.roundDamage = [0, 0];
    this.phase = 'countdown';
    this.phaseT = COUNTDOWN;
    this.roundTime = ROUND_TIME;
    this.lastCount = 0;
    this.roundId++;
  }

  step(inputs: [PlayerInput, PlayerInput]) {
    const dt = TICK;
    this.elapsed += dt;
    for (const p of this.players) p.hitFlash = Math.max(0, p.hitFlash - dt);
    for (const k of this.pickups) k.age += dt;

    switch (this.phase) {
      case 'countdown': {
        this.phaseT -= dt;
        const n = Math.ceil(this.phaseT);
        if (n > 0 && n !== this.lastCount) {
          this.lastCount = n;
          this.events.push({ type: 'countdown', n });
        }
        // Chỉ cho xoay nòng trong lúc đếm ngược
        this.players[0].aim = inputs[0].aim;
        this.players[1].aim = inputs[1].aim;
        if (this.phaseT <= 0) {
          this.phase = 'playing';
          this.events.push({ type: 'go' });
        }
        break;
      }
      case 'playing': {
        this.roundTime = Math.max(0, this.roundTime - dt);
        this.updatePlayer(this.players[0], inputs[0], dt);
        this.updatePlayer(this.players[1], inputs[1], dt);
        this.separatePlayers();
        this.updatePickups(dt);
        this.updateBullets(dt, true);
        this.checkRoundEnd();
        break;
      }
      case 'roundEnd': {
        this.phaseT -= dt;
        this.updateBullets(dt, false);
        if (this.phaseT <= 0) {
          const over =
            this.score[0] >= ROUNDS_TO_WIN || this.score[1] >= ROUNDS_TO_WIN || this.round >= MAX_ROUNDS;
          if (over) {
            this.phase = 'matchEnd';
            this.winner = this.score[0] > this.score[1] ? 0 : this.score[1] > this.score[0] ? 1 : null;
            this.events.push({ type: 'matchEnd', winner: this.winner });
          } else {
            this.round++;
            this.startRound();
          }
        }
        break;
      }
      case 'matchEnd':
        this.updateBullets(dt, false);
        break;
    }
  }

  private updatePlayer(p: Player, inp: PlayerInput, dt: number) {
    if (!p.alive) return;
    p.aim = inp.aim;
    p.dashCd = Math.max(0, p.dashCd - dt);
    p.fireCd = Math.max(0, p.fireCd - dt);
    p.damageBoostT = Math.max(0, p.damageBoostT - dt);
    p.speedBoostT = Math.max(0, p.speedBoostT - dt);

    // Đổi súng
    let target = inp.weapon;
    if (inp.cycle) target = (p.weapon + 1) % p.weapons.length;
    if (target !== null && target !== p.weapon && target >= 0 && target < p.weapons.length) {
      p.weapon = target;
      p.reloadT = 0;
      p.fireCd = Math.max(p.fireCd, SWITCH_DELAY);
      this.events.push({ type: 'switch', owner: p.id });
    }

    // Nạp đạn
    if (p.reloadT > 0) {
      p.reloadT -= dt;
      if (p.reloadT <= 0) {
        p.reloadT = 0;
        p.ammo[p.weapon] = p.def.mag;
        this.events.push({ type: 'reloadDone', owner: p.id });
      }
    } else if (inp.reload) {
      this.startReload(p);
    }

    // Lướt
    if (inp.dash && p.dashCd <= 0) {
      let dx = inp.mx, dy = inp.my;
      const l = Math.hypot(dx, dy);
      if (l < 0.01) { dx = Math.cos(p.aim); dy = Math.sin(p.aim); } else { dx /= l; dy /= l; }
      p.dashDx = dx; p.dashDy = dy; p.dashT = DASH_TIME; p.dashCd = DASH_CD;
      this.events.push({ type: 'dash', owner: p.id, x: p.x, y: p.y });
    }

    // Di chuyển
    if (p.dashT > 0) {
      p.dashT -= dt;
      const s = DASH_DIST / DASH_TIME;
      p.vx = p.dashDx * s; p.vy = p.dashDy * s;
    } else {
      let mx = inp.mx, my = inp.my;
      const l = Math.hypot(mx, my);
      if (l > 1) { mx /= l; my /= l; }
      const speed = PLAYER_SPEED * (p.speedBoostT > 0 ? SPEED_MULT : 1);
      p.vx = mx * speed; p.vy = my * speed;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    this.collideWalls(p);

    // Bắn
    if (inp.shoot && p.fireCd <= 0 && !p.reloading) {
      if (p.ammo[p.weapon] > 0) this.fire(p);
      else this.startReload(p);
    }
  }

  private collideWalls(p: Player) {
    for (const w of this.map.walls) resolveCircleRect(p, PLAYER_R, w);
  }

  private separatePlayers() {
    const [a, b] = this.players;
    if (!a.alive || !b.alive) return;
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), min = PLAYER_R * 2;
    if (d >= min || d < 1e-3) return;
    const push = (min - d) / 2;
    a.x -= (dx / d) * push; a.y -= (dy / d) * push;
    b.x += (dx / d) * push; b.y += (dy / d) * push;
    this.collideWalls(a);
    this.collideWalls(b);
  }

  // ---------- Vật phẩm ----------
  private updatePickups(dt: number) {
    this.pickupT -= dt;
    if (this.pickupT <= 0) {
      this.pickupT = PICKUP_INTERVAL;
      this.spawnPickups();
    }
    for (const k of [...this.pickups]) {
      for (const p of this.players) {
        if (!p.alive || Math.hypot(p.x - k.x, p.y - k.y) > PLAYER_R + PICKUP_R) continue;
        this.applyPickup(p, k.kind);
        this.events.push({ type: 'pickup', owner: p.id, kind: k.kind, x: k.x, y: k.y });
        this.pickups = this.pickups.filter((o) => o !== k);
        break;
      }
    }
  }

  private spawnPickups() {
    const free = this.map.pickupGroups.filter((g) =>
      g.every((pt) => !this.pickups.some((k) => Math.hypot(k.x - pt.x, k.y - pt.y) < 1)));
    if (!free.length) return;
    const group = free[Math.floor(Math.random() * free.length)];
    if (this.pickups.length + group.length > MAX_PICKUPS) return;
    const kind = randomPickupKind();
    for (const pt of group) {
      this.pickups.push({ id: ++this.pickupSeq, kind, x: pt.x, y: pt.y, age: 0 });
      this.events.push({ type: 'pickupSpawn', kind, x: pt.x, y: pt.y });
    }
  }

  private applyPickup(p: Player, kind: PickupKind) {
    switch (kind) {
      case 'health': p.hp = Math.min(MAX_HP, p.hp + HEAL_AMOUNT); break;
      case 'armor': p.armor = Math.min(MAX_ARMOR, p.armor + ARMOR_AMOUNT); break;
      case 'damage': p.damageBoostT = BOOST_TIME; break;
      case 'speed': p.speedBoostT = BOOST_TIME; break;
      case 'ammo':
        p.ammo = p.weapons.map((w) => w.mag);
        p.reloadT = 0;
        p.dashCd = 0;
        break;
    }
  }

  // ---------- Bắn ----------
  private startReload(p: Player) {
    if (p.reloading || p.ammo[p.weapon] >= p.def.mag) return;
    p.reloadT = p.def.reload;
    this.events.push({ type: 'reload', owner: p.id });
  }

  private fire(p: Player) {
    const d = p.def;
    p.ammo[p.weapon]--;
    p.fireCd = 1 / d.fireRate;
    const mx = p.x + Math.cos(p.aim) * (PLAYER_R + 12);
    const my = p.y + Math.sin(p.aim) * (PLAYER_R + 12);
    this.events.push({ type: 'shoot', owner: p.id, weapon: d.id, x: mx, y: my, angle: p.aim });

    // Nòng súng xuyên vào tường → không sinh đạn (chống bắn xuyên tường khi áp sát)
    const blocked = this.map.walls.some((w) => segmentRect(p.x, p.y, mx, my, w) !== null);
    if (blocked) {
      this.events.push({ type: 'spark', x: mx, y: my });
    } else {
      const damage = Math.round(d.damage * (p.damageBoostT > 0 ? DAMAGE_MULT : 1));
      for (let i = 0; i < d.pellets; i++) {
        const off = d.pellets > 1
          ? (i / (d.pellets - 1) - 0.5) * d.spread + (Math.random() - 0.5) * d.spread * 0.3
          : (Math.random() - 0.5) * d.spread;
        const a = p.aim + off;
        this.bullets.push({
          x: mx, y: my,
          vx: Math.cos(a) * d.bulletSpeed, vy: Math.sin(a) * d.bulletSpeed,
          owner: p.id, damage, life: d.range / d.bulletSpeed, weapon: d.id, lifesteal: d.lifesteal,
        });
        p.stats.shots++;
      }
    }
    if (p.ammo[p.weapon] === 0) this.startReload(p);
  }

  private updateBullets(dt: number, canDamage: boolean) {
    const alive: Bullet[] = [];
    for (const b of this.bullets) {
      const nx = b.x + b.vx * dt, ny = b.y + b.vy * dt;
      let tHit = Infinity;
      let hitPlayer: Player | null = null;
      for (const w of this.map.walls) {
        const t = segmentRect(b.x, b.y, nx, ny, w);
        if (t !== null && t < tHit) tHit = t;
      }
      const target = this.players[1 - b.owner];
      if (target.alive) {
        const t = segmentCircle(b.x, b.y, nx, ny, target.x, target.y, PLAYER_R);
        if (t !== null && t <= tHit) { tHit = t; hitPlayer = target; }
      }
      if (tHit <= 1) {
        const hx = b.x + (nx - b.x) * tHit, hy = b.y + (ny - b.y) * tHit;
        if (hitPlayer && canDamage) this.damage(hitPlayer, b, hx, hy);
        else this.events.push({ type: 'spark', x: hx, y: hy });
        continue;
      }
      b.x = nx; b.y = ny; b.life -= dt;
      if (b.life > 0) alive.push(b);
    }
    this.bullets = alive;
  }

  private damage(target: Player, b: Bullet, x: number, y: number) {
    const shooter = this.players[b.owner];
    // Giáp hấp thụ sát thương trước
    const absorbed = Math.min(target.armor, b.damage);
    target.armor -= absorbed;
    const toHp = Math.min(target.hp, b.damage - absorbed);
    target.hp -= toHp;
    const dealt = absorbed + toHp;
    target.hitFlash = 0.12;
    shooter.stats.hits++;
    shooter.stats.damage += dealt;
    this.roundDamage[target.id] += dealt;
    if (b.lifesteal > 0 && shooter.alive) shooter.hp = Math.min(MAX_HP, shooter.hp + dealt * b.lifesteal);
    this.events.push({
      type: 'hit', target: target.id, x, y, damage: b.damage, angle: Math.atan2(b.vy, b.vx), armor: absorbed > 0,
    });
    if (target.hp <= 0) {
      target.alive = false;
      target.stats.deaths++;
      shooter.stats.kills++;
      shooter.stats.weaponKills[b.weapon] = (shooter.stats.weaponKills[b.weapon] ?? 0) + 1;
      this.events.push({ type: 'kill', killer: shooter.id, victim: target.id, weapon: b.weapon, x: target.x, y: target.y });
    }
  }

  private checkRoundEnd() {
    const [a, b] = this.players;
    if (!a.alive || !b.alive) {
      this.endRound(a.alive ? 0 : b.alive ? 1 : null, 'kill');
    } else if (this.roundTime <= 0) {
      const ea = a.hp + a.armor, eb = b.hp + b.armor;
      this.endRound(ea > eb ? 0 : eb > ea ? 1 : null, 'time');
    }
  }

  private endRound(winner: Side | null, reason: 'kill' | 'time') {
    if (winner !== null) this.score[winner]++;
    this.rounds.push({ winner, duration: ROUND_TIME - this.roundTime, damageTaken: [...this.roundDamage] });
    this.phase = 'roundEnd';
    this.phaseT = ROUND_END_DELAY;
    this.events.push({ type: 'roundEnd', winner, reason });
  }
}
