import {
  TICK, W, H, PLAYER_R, PLAYER_SPEED, MAX_HP, DASH_DIST, DASH_TIME, DASH_CD, SWITCH_DELAY,
  ROUNDS_TO_WIN, MAX_ROUNDS, ROUND_TIME, COUNTDOWN, ROUND_END_DELAY, TEAM_COLORS, type Team,
} from './constants';
import { MAX_BULLET_DAMAGE, type Tracer, type WeaponDef, type WeaponId } from './weapons';
import type { GameMap, Rect } from './map';
import { resolveCircleRect, segmentRect, segmentRectRange, segmentCircle } from './collision';
import {
  type PickupKind, PICKUP_R, PICKUP_FIRST, PICKUP_INTERVAL, MAX_PICKUPS, HEAL_AMOUNT, ARMOR_AMOUNT,
  MAX_ARMOR, BOOST_TIME, DAMAGE_MULT, SPEED_MULT, randomPickupKind,
} from './pickups';

/**
 * Mô phỏng trận đấu thuần logic (không DOM, không mạng, không render).
 * Nhận input của mọi người chơi mỗi tick → chạy được ở chế độ offline lẫn trên máy chủ phòng online.
 * Hỗ trợ 1vs1, 2vs2, 3vs3 (2 đội, không bắn đồng đội).
 */

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

// ---------- Di chuyển (dùng chung cho máy chủ và dự đoán phía người chơi online) ----------
export interface Mover {
  x: number; y: number; vx: number; vy: number; aim: number;
  dashT: number; dashCd: number; dashDx: number; dashDy: number; speedBoostT: number;
}

/** Di chuyển 1 tick. Trả về true nếu vừa bắt đầu lướt. */
export function moveStep(p: Mover, inp: PlayerInput, walls: Rect[], moveMult: number, dt = TICK): boolean {
  p.dashCd = Math.max(0, p.dashCd - dt);
  p.speedBoostT = Math.max(0, p.speedBoostT - dt);
  let dashed = false;
  if (inp.dash && p.dashCd <= 0) {
    let dx = inp.mx, dy = inp.my;
    const l = Math.hypot(dx, dy);
    if (l < 0.01) { dx = Math.cos(p.aim); dy = Math.sin(p.aim); } else { dx /= l; dy /= l; }
    p.dashDx = dx; p.dashDy = dy; p.dashT = DASH_TIME; p.dashCd = DASH_CD;
    dashed = true;
  }
  if (p.dashT > 0) {
    p.dashT -= dt;
    const s = DASH_DIST / DASH_TIME;
    p.vx = p.dashDx * s; p.vy = p.dashDy * s;
  } else {
    let mx = inp.mx, my = inp.my;
    const l = Math.hypot(mx, my);
    if (l > 1) { mx /= l; my /= l; }
    const speed = PLAYER_SPEED * moveMult * (p.speedBoostT > 0 ? SPEED_MULT : 1);
    p.vx = mx * speed; p.vy = my * speed;
  }
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  for (const w of walls) resolveCircleRect(p, PLAYER_R, w);
  return dashed;
}

// ---------- Người chơi ----------
export interface PlayerStats {
  shots: number; hits: number; damage: number; kills: number; deaths: number;
  weaponKills: Partial<Record<WeaponId, number>>;
}

export class Player implements Mover {
  x = 0; y = 0; vx = 0; vy = 0; aim = 0;
  hp = MAX_HP;
  armor = 0;
  alive = true;
  weapon = 0;
  ammo: number[];
  reloadT = 0;
  fireCd = 0;
  burstLeft = 0;
  burstT = 0;
  dashT = 0;
  dashCd = 0;
  dashDx = 0;
  dashDy = 0;
  damageBoostT = 0;
  speedBoostT = 0;
  hitFlash = 0;
  stats: PlayerStats = { shots: 0, hits: 0, damage: 0, kills: 0, deaths: 0, weaponKills: {} };

  constructor(
    public readonly id: number,
    public name: string,
    public readonly team: Team,
    public readonly color: string,
    public readonly weapons: WeaponDef[],
  ) {
    this.ammo = weapons.map((w) => w.mag);
  }

  get def(): WeaponDef { return this.weapons[this.weapon]; }
  get reloading(): boolean { return this.reloadT > 0; }

  reset(x: number, y: number, aim: number) {
    this.x = x; this.y = y; this.vx = 0; this.vy = 0; this.aim = aim;
    this.hp = MAX_HP; this.armor = 0; this.alive = true; this.weapon = 0;
    this.ammo = this.weapons.map((w) => w.mag);
    this.reloadT = 0; this.fireCd = 0; this.burstLeft = 0; this.burstT = 0;
    this.dashCd = 0; this.dashT = 0; this.hitFlash = 0;
    this.damageBoostT = 0; this.speedBoostT = 0;
  }
}

export interface Bullet {
  id: number;
  x: number; y: number; vx: number; vy: number;
  owner: number; team: Team; damage: number; life: number;
  weapon: WeaponId; lifesteal: number; bounces: number; pierce: number; tracer: Tracer;
}

export interface Pickup { id: number; kind: PickupKind; x: number; y: number; age: number }

export type Phase = 'countdown' | 'playing' | 'roundEnd' | 'matchEnd';

export type GameEvent =
  | { type: 'shoot'; owner: number; weapon: WeaponId; mod: string; x: number; y: number; angle: number }
  | { type: 'hit'; target: number; x: number; y: number; damage: number; angle: number; armor: boolean }
  | { type: 'kill'; killer: number; victim: number; weapon: WeaponId; x: number; y: number }
  | { type: 'spark'; x: number; y: number }
  | { type: 'reload'; owner: number }
  | { type: 'reloadDone'; owner: number }
  | { type: 'switch'; owner: number }
  | { type: 'dash'; owner: number; x: number; y: number }
  | { type: 'pickupSpawn'; kind: PickupKind; x: number; y: number }
  | { type: 'pickup'; owner: number; kind: PickupKind; x: number; y: number }
  | { type: 'countdown'; n: number }
  | { type: 'go' }
  | { type: 'roundEnd'; winner: Team | null; reason: 'kill' | 'time' }
  | { type: 'matchEnd'; winner: Team | null };

export interface RoundResult { winner: Team | null; duration: number; damageTaken: number[] }

export interface RosterEntry { name: string; team: Team; weapons: WeaponDef[] }

/** Những gì renderer cần — World (offline/chủ phòng) và ClientWorld (người vào phòng) đều cung cấp. */
export interface WorldView {
  map: GameMap;
  players: Player[];
  bullets: Bullet[];
  pickups: Pickup[];
  phase: Phase;
  round: number;
  roundTime: number;
  score: [number, number];
  elapsed: number;
}

export class World implements WorldView {
  readonly players: Player[];
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
  winner: Team | null = null;
  rounds: RoundResult[] = [];
  private lastCount = 0;
  private pickupT = 0;
  private seq = 0;
  private roundDamage: number[];

  constructor(public readonly map: GameMap, roster: RosterEntry[]) {
    const perTeam = [0, 0];
    this.players = roster.map((r, i) => new Player(i, r.name, r.team, TEAM_COLORS[r.team][perTeam[r.team]++ % 3], r.weapons));
    this.roundDamage = this.players.map(() => 0);
    this.startRound();
  }

  teamOf(team: Team) { return this.players.filter((p) => p.team === team); }

  private startRound() {
    const idx = [0, 0];
    for (const p of this.players) {
      const spots = this.map.spawns[p.team];
      const s = spots[idx[p.team]++ % spots.length];
      p.reset(s.x, s.y, Math.atan2(H / 2 - s.y, W / 2 - s.x));
    }
    this.bullets = [];
    this.pickups = [];
    this.pickupT = PICKUP_FIRST;
    this.roundDamage = this.players.map(() => 0);
    this.phase = 'countdown';
    this.phaseT = COUNTDOWN;
    this.roundTime = ROUND_TIME;
    this.lastCount = 0;
    this.roundId++;
  }

  /** inputs[i] là input của người chơi có id = i. */
  step(inputs: PlayerInput[]) {
    const dt = TICK;
    this.elapsed += dt;
    for (const p of this.players) p.hitFlash = Math.max(0, p.hitFlash - dt);
    for (const k of this.pickups) k.age += dt;
    const input = (i: number) => inputs[i] ?? NO_INPUT;

    switch (this.phase) {
      case 'countdown': {
        this.phaseT -= dt;
        const n = Math.ceil(this.phaseT);
        if (n > 0 && n !== this.lastCount) {
          this.lastCount = n;
          this.events.push({ type: 'countdown', n });
        }
        for (const p of this.players) p.aim = input(p.id).aim; // chỉ cho xoay nòng
        if (this.phaseT <= 0) {
          this.phase = 'playing';
          this.events.push({ type: 'go' });
        }
        break;
      }
      case 'playing': {
        this.roundTime = Math.max(0, this.roundTime - dt);
        for (const p of this.players) this.updatePlayer(p, input(p.id), dt);
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
    p.fireCd = Math.max(0, p.fireCd - dt);
    p.damageBoostT = Math.max(0, p.damageBoostT - dt);

    // Đổi súng
    let target = inp.weapon;
    if (inp.cycle) target = (p.weapon + 1) % p.weapons.length;
    if (target !== null && target !== p.weapon && target >= 0 && target < p.weapons.length) {
      p.weapon = target;
      p.reloadT = 0;
      p.burstLeft = 0;
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

    // Di chuyển
    if (moveStep(p, inp, this.map.walls, p.def.moveMult, dt)) {
      this.events.push({ type: 'dash', owner: p.id, x: p.x, y: p.y });
    }

    // Phần còn lại của loạt đạn
    if (p.burstLeft > 0) {
      p.burstT -= dt;
      if (p.burstT <= 0) {
        if (p.ammo[p.weapon] > 0 && !p.reloading) {
          this.shootOnce(p);
          p.burstLeft--;
          p.burstT = p.def.burstGap;
        } else {
          p.burstLeft = 0;
        }
      }
    } else if (inp.shoot && p.fireCd <= 0 && !p.reloading) {
      // Bóp cò
      if (p.ammo[p.weapon] > 0) {
        p.fireCd = 1 / p.def.fireRate;
        this.shootOnce(p);
        if (p.def.burst > 1 && p.ammo[p.weapon] > 0) {
          p.burstLeft = p.def.burst - 1;
          p.burstT = p.def.burstGap;
        }
      } else {
        this.startReload(p);
      }
    }
  }

  private collideWalls(p: Player) {
    for (const w of this.map.walls) resolveCircleRect(p, PLAYER_R, w);
  }

  private separatePlayers() {
    const ps = this.players;
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i], b = ps[j];
        if (!a.alive || !b.alive) continue;
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), min = PLAYER_R * 2;
        if (d >= min || d < 1e-3) continue;
        const push = (min - d) / 2;
        a.x -= (dx / d) * push; a.y -= (dy / d) * push;
        b.x += (dx / d) * push; b.y += (dy / d) * push;
        this.collideWalls(a);
        this.collideWalls(b);
      }
    }
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
      this.pickups.push({ id: ++this.seq, kind, x: pt.x, y: pt.y, age: 0 });
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
    p.burstLeft = 0;
    this.events.push({ type: 'reload', owner: p.id });
  }

  /** Bắn 1 phát (có thể nhiều viên với shotgun). */
  private shootOnce(p: Player) {
    const d = p.def;
    p.ammo[p.weapon]--;
    const mx = p.x + Math.cos(p.aim) * (PLAYER_R + 12);
    const my = p.y + Math.sin(p.aim) * (PLAYER_R + 12);
    this.events.push({ type: 'shoot', owner: p.id, weapon: d.id, mod: d.modId, x: mx, y: my, angle: p.aim });

    // Nòng súng xuyên vào tường → không sinh đạn (chống bắn xuyên tường khi áp sát)
    const blocked = this.map.walls.some((w) => segmentRect(p.x, p.y, mx, my, w) !== null);
    if (blocked) {
      this.events.push({ type: 'spark', x: mx, y: my });
    } else {
      const damage = Math.min(MAX_BULLET_DAMAGE, Math.round(d.damage * (p.damageBoostT > 0 ? DAMAGE_MULT : 1)));
      for (let i = 0; i < d.pellets; i++) {
        const off = d.pellets > 1
          ? (i / (d.pellets - 1) - 0.5) * d.spread + (Math.random() - 0.5) * d.spread * 0.3
          : (Math.random() - 0.5) * d.spread;
        const a = p.aim + off;
        this.bullets.push({
          id: ++this.seq,
          x: mx, y: my,
          vx: Math.cos(a) * d.bulletSpeed, vy: Math.sin(a) * d.bulletSpeed,
          owner: p.id, team: p.team, damage, life: d.range / d.bulletSpeed,
          weapon: d.id, lifesteal: d.lifesteal, bounces: d.bounces, pierce: d.pierce, tracer: d.tracer,
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
      let wall: Rect | null = null;
      let hitPlayer: Player | null = null;
      for (const w of this.map.walls) {
        const t = segmentRect(b.x, b.y, nx, ny, w);
        if (t !== null && t < tHit) { tHit = t; wall = w; }
      }
      for (const p of this.players) {
        if (!p.alive || p.team === b.team) continue;
        const t = segmentCircle(b.x, b.y, nx, ny, p.x, p.y, PLAYER_R);
        if (t !== null && t <= tHit) { tHit = t; hitPlayer = p; wall = null; }
      }
      if (tHit <= 1) {
        const hx = b.x + (nx - b.x) * tHit, hy = b.y + (ny - b.y) * tHit;
        if (hitPlayer) {
          if (canDamage) this.damage(hitPlayer, b, hx, hy);
          else this.events.push({ type: 'spark', x: hx, y: hy });
          continue;
        }
        this.events.push({ type: 'spark', x: hx, y: hy });
        if (wall && b.pierce > 0 && this.pierceWall(b, wall, hx, hy)) { alive.push(b); continue; }
        if (wall && b.bounces > 0) { this.bounce(b, wall, hx, hy); alive.push(b); continue; }
        continue;
      }
      b.x = nx; b.y = ny; b.life -= dt;
      if (b.life > 0) alive.push(b);
    }
    this.bullets = alive;
  }

  /** Đưa viên đạn ra phía bên kia bức tường. */
  private pierceWall(b: Bullet, w: Rect, hx: number, hy: number): boolean {
    const sp = Math.hypot(b.vx, b.vy);
    const dx = b.vx / sp, dy = b.vy / sp, far = w.w + w.h + 10;
    const r = segmentRectRange(hx, hy, hx + dx * far, hy + dy * far, w);
    if (!r) return false;
    b.x = hx + dx * (far * r[1] + 1.5);
    b.y = hy + dy * (far * r[1] + 1.5);
    b.pierce--;
    b.damage = Math.round(b.damage * 0.7);
    this.events.push({ type: 'spark', x: b.x, y: b.y });
    return true;
  }

  /** Phản xạ viên đạn theo mặt tường bị chạm. */
  private bounce(b: Bullet, w: Rect, hx: number, hy: number) {
    const eps = 0.5;
    const onVertical = (Math.abs(hx - w.x) < eps || Math.abs(hx - (w.x + w.w)) < eps) && hy > w.y + eps && hy < w.y + w.h - eps;
    if (onVertical) b.vx = -b.vx;
    else b.vy = -b.vy;
    const sp = Math.hypot(b.vx, b.vy);
    b.x = hx + (b.vx / sp) * 1.5;
    b.y = hy + (b.vy / sp) * 1.5;
    b.bounces--;
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
      target.burstLeft = 0;
      target.stats.deaths++;
      shooter.stats.kills++;
      shooter.stats.weaponKills[b.weapon] = (shooter.stats.weaponKills[b.weapon] ?? 0) + 1;
      this.events.push({ type: 'kill', killer: shooter.id, victim: target.id, weapon: b.weapon, x: target.x, y: target.y });
    }
  }

  private checkRoundEnd() {
    const alive0 = this.players.some((p) => p.team === 0 && p.alive);
    const alive1 = this.players.some((p) => p.team === 1 && p.alive);
    if (!alive0 || !alive1) {
      this.endRound(alive0 ? 0 : alive1 ? 1 : null, 'kill');
    } else if (this.roundTime <= 0) {
      const sum = (t: Team) => this.teamOf(t).reduce((s, p) => s + (p.alive ? p.hp + p.armor : 0), 0);
      const a = sum(0), b = sum(1);
      this.endRound(a > b ? 0 : b > a ? 1 : null, 'time');
    }
  }

  private endRound(winner: Team | null, reason: 'kill' | 'time') {
    if (winner !== null) this.score[winner]++;
    this.rounds.push({ winner, duration: ROUND_TIME - this.roundTime, damageTaken: [...this.roundDamage] });
    this.phase = 'roundEnd';
    this.phaseT = ROUND_END_DELAY;
    this.events.push({ type: 'roundEnd', winner, reason });
  }
}
