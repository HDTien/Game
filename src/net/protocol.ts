import type { Team } from '../game/constants';
import type { Difficulty } from '../game/bot';
import type { PickupKind } from '../game/pickups';
import type { Tracer, WeaponId } from '../game/weapons';
import type { Bullet, GameEvent, Phase, Pickup, Player, PlayerInput, World } from '../game/world';

/**
 * Giao thức online (P2P qua WebRTC, chủ phòng là máy chủ):
 *   người chơi ──input (60/s)──▶ chủ phòng chạy World ──snapshot (30/s)──▶ người chơi
 * Người chơi chỉ gửi phím bấm, không bao giờ gửi vị trí/sát thương → chủ phòng quyết định mọi thứ.
 */

export const PROTOCOL_VERSION = 2;
export const PEER_PREFIX = 'dausung-game-';
export const SNAPSHOT_EVERY = 2; // gửi snapshot mỗi 2 tick → 30 lần/giây
export const MAX_NAME = 20;

export const PEER_OPTIONS = {
  debug: 0,
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
    ],
  },
};

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function makeRoomCode(): string {
  let s = '';
  for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}
export const normalizeCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);

export type TeamSize = 1 | 2 | 3;
export type Mods = Partial<Record<WeaponId, string>>;

export interface LobbySlot { key: string; name: string; team: Team; bot: boolean; host: boolean; ping: number | null }
export interface LobbyState {
  code: string;
  teamSize: TeamSize;
  mapId: string;
  botDifficulty: Difficulty;
  fillBots: boolean;
  slots: LobbySlot[];
  inGame: boolean;
}

export interface RosterInfo { name: string; team: Team; bot: boolean; mods: Mods }
export interface StartInfo { mapId: string; roster: RosterInfo[]; you: number; teamSize: TeamSize; botDifficulty: Difficulty }

export interface ResultInfo {
  winner: Team | null;
  score: [number, number];
  roundWinners: (Team | null)[];
  /** [bắn, trúng, sát thương, hạ gục, bị hạ] theo id người chơi */
  stats: number[][];
  /** Người chơi có round nào đội thắng mà bản thân không mất máu không */
  flawless: boolean[];
  durationSec: number;
}

export type ClientMsg =
  | { t: 'hello'; v: number; name: string; mods: Mods }
  | { t: 'input'; s: number; i: PackedInput }
  | { t: 'team'; team: Team }
  | { t: 'ping'; ts: number; rtt: number | null };

export type HostMsg =
  | { t: 'welcome'; key: string }
  | { t: 'reject'; reason: string }
  | { t: 'lobby'; lobby: LobbyState }
  | { t: 'start'; start: StartInfo }
  | { t: 'snap'; s: Snapshot }
  | { t: 'result'; r: ResultInfo }
  | { t: 'pong'; ts: number }
  | { t: 'closed'; reason: string };

// ---------- Input ----------
/** [mx, my, aim, cờ (bắn|nạp|lướt|đổi), súng (-1 = không)] */
export type PackedInput = [number, number, number, number, number];

export function packInput(i: PlayerInput): PackedInput {
  const flags = (i.shoot ? 1 : 0) | (i.reload ? 2 : 0) | (i.dash ? 4 : 0) | (i.cycle ? 8 : 0);
  return [Math.round(i.mx * 100) / 100, Math.round(i.my * 100) / 100, Math.round(i.aim * 1000) / 1000, flags, i.weapon ?? -1];
}

export function unpackInput(p: PackedInput): PlayerInput {
  const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0);
  const flags = num(p[3], 0, 15) | 0;
  const weapon = num(p[4], -1, 9) | 0;
  return {
    mx: num(p[0], -1, 1),
    my: num(p[1], -1, 1),
    aim: num(p[2], -10, 10),
    shoot: !!(flags & 1),
    reload: !!(flags & 2),
    dash: !!(flags & 4),
    cycle: !!(flags & 8),
    weapon: weapon >= 0 ? weapon : null,
  };
}

// ---------- Snapshot ----------
export const PHASES: Phase[] = ['countdown', 'playing', 'roundEnd', 'matchEnd'];
const TRACERS: Tracer[] = ['normal', 'faint', 'heavy'];
const KINDS: PickupKind[] = ['health', 'armor', 'damage', 'speed', 'ammo'];

export interface Snapshot {
  k: number;          // tick của chủ phòng
  ack: number;        // input cuối cùng của người nhận đã được xử lý
  ph: number;         // phase
  rt: number;         // thời gian round còn lại
  r: number;          // round
  rid: number;        // roundId
  sc: [number, number];
  p: number[][];      // người chơi
  b: number[][];      // đạn
  pk: number[][];     // vật phẩm
  ev: GameEvent[];
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** [x, y, aim, hp, armor, alive, weapon, đạn, reloadT, dashT, dashCd, dashDx, dashDy, dmgT, spdT, hitFlash] */
export function packPlayer(p: Player): number[] {
  return [
    r1(p.x), r1(p.y), r3(p.aim), r1(p.hp), r1(p.armor), p.alive ? 1 : 0, p.weapon, p.ammo[p.weapon],
    r2(p.reloadT), r3(p.dashT), r2(p.dashCd), r3(p.dashDx), r3(p.dashDy), r1(p.damageBoostT), r2(p.speedBoostT), r2(p.hitFlash),
  ];
}

/** Áp phần trạng thái không phải vị trí (vị trí do nội suy / dự đoán xử lý). */
export function applyPlayerState(p: Player, a: number[]) {
  p.hp = a[3]; p.armor = a[4]; p.alive = a[5] === 1;
  if (a[6] >= 0 && a[6] < p.weapons.length) p.weapon = a[6];
  p.ammo[p.weapon] = a[7];
  p.reloadT = a[8]; p.dashCd = a[10]; p.damageBoostT = a[13]; p.speedBoostT = a[14]; p.hitFlash = a[15];
}

export function makeSnapshot(w: World, tick: number, events: GameEvent[]): Snapshot {
  return {
    k: tick,
    ack: 0,
    ph: PHASES.indexOf(w.phase),
    rt: r1(w.roundTime),
    r: w.round,
    rid: w.roundId,
    sc: w.score,
    p: w.players.map(packPlayer),
    b: w.bullets.map((b) => [b.id, r1(b.x), r1(b.y), Math.round(b.vx), Math.round(b.vy), b.team, TRACERS.indexOf(b.tracer)]),
    pk: w.pickups.map((k) => [k.id, KINDS.indexOf(k.kind), k.x, k.y, r2(k.age)]),
    ev: events,
  };
}

export function unpackBullet(a: number[]): Bullet {
  return {
    id: a[0], x: a[1], y: a[2], vx: a[3], vy: a[4], team: a[5] as Team, tracer: TRACERS[a[6]] ?? 'normal',
    owner: -1, damage: 0, life: 1, weapon: 'pistol', lifesteal: 0, bounces: 0, pierce: 0,
  };
}

export function unpackPickup(a: number[]): Pickup {
  return { id: a[0], kind: KINDS[a[1]] ?? 'health', x: a[2], y: a[3], age: a[4] };
}
