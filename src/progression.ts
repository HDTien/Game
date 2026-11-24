import type { Difficulty } from './game/bot';
import { WEAPON_ORDER, MODS, STANDARD, buildWeapon, findMod, type ModDef, type WeaponDef, type WeaponId } from './game/weapons';

/**
 * Tiến trình: xu, kinh nghiệm, cấp độ, thành tựu, chế độ súng.
 * Chế độ súng là "đánh đổi" chứ không mạnh hơn → không phá cân bằng khi chơi online.
 */

export interface ModProgress { owned: string[]; selected: string }

export interface Progress {
  coins: number;
  xp: number;    // kinh nghiệm trong cấp hiện tại
  level: number;
  mods: Record<WeaponId, ModProgress>;
  achievements: string[];
  winStreak: number;
  winsByDiff: Record<Difficulty, number>;
  onlineWins: number;
  totalKills: number;
}

export type MatchKind = Difficulty | 'online';

function defaultMods(): Record<WeaponId, ModProgress> {
  const m = {} as Record<WeaponId, ModProgress>;
  for (const id of WEAPON_ORDER) m[id] = { owned: [STANDARD], selected: STANDARD };
  return m;
}

export function defaultProgress(): Progress {
  return {
    coins: 0, xp: 0, level: 1, mods: defaultMods(), achievements: [], winStreak: 0,
    winsByDiff: { easy: 0, normal: 0, hard: 0 }, onlineWins: 0, totalKills: 0,
  };
}

/** Giá các cấp nâng cấp ở phiên bản cũ — dùng để hoàn xu. */
const OLD_UPGRADE_COSTS = [100, 250, 500, 1000];

export function normalizeProgress(raw: unknown): Progress {
  const d = defaultProgress();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<Progress> & { weapons?: Record<string, { level?: number; kills?: number }>; botKills?: number };
  const mods = defaultMods();
  for (const id of WEAPON_ORDER) {
    const m = r.mods?.[id];
    if (!m) continue;
    const owned = [STANDARD, ...(m.owned ?? []).filter((x) => x !== STANDARD && MODS[id].some((md) => md.id === x))];
    mods[id] = { owned, selected: owned.includes(m.selected) ? m.selected : STANDARD };
  }
  // Chuyển từ hệ thống nâng cấp cũ: hoàn lại toàn bộ xu đã tiêu
  let refund = 0;
  if (r.weapons && !r.mods) {
    for (const w of Object.values(r.weapons)) {
      for (let lv = 2; lv <= (w.level ?? 1); lv++) refund += OLD_UPGRADE_COSTS[lv - 2] ?? 0;
    }
  }
  return {
    coins: (r.coins ?? 0) + refund,
    xp: r.xp ?? 0,
    level: r.level ?? 1,
    mods,
    achievements: Array.isArray(r.achievements) ? r.achievements.filter((a) => a !== 'gunsmith') : [],
    winStreak: r.winStreak ?? 0,
    winsByDiff: { ...d.winsByDiff, ...r.winsByDiff },
    onlineWins: r.onlineWins ?? 0,
    totalKills: r.totalKills ?? r.botKills ?? 0,
  };
}

export const xpToNext = (level: number) => 100 + 50 * (level - 1);

// ---------- Chế độ súng ----------
export function modBlocker(p: Progress, id: WeaponId, mod: ModDef): string | null {
  if (p.mods[id].owned.includes(mod.id)) return null;
  if (p.level < mod.reqLevel) return `Cần cấp ${mod.reqLevel}`;
  if (p.coins < mod.cost) return `Thiếu ${mod.cost - p.coins} xu`;
  return null;
}

/** Mua chế độ súng. Trả về thành tựu mới (nếu có). */
export function buyMod(p: Progress, id: WeaponId, modId: string): AchievementDef[] {
  const mod = findMod(id, modId);
  if (p.mods[id].owned.includes(mod.id) || modBlocker(p, id, mod)) return [];
  p.coins -= mod.cost;
  p.mods[id].owned.push(mod.id);
  p.mods[id].selected = mod.id;
  return grant(p, ['collector'], (a) => a.id === 'collector' && ownedModCount(p) >= 6);
}

export function selectMod(p: Progress, id: WeaponId, modId: string) {
  if (p.mods[id].owned.includes(modId)) p.mods[id].selected = modId;
}

export const ownedModCount = (p: Progress) =>
  WEAPON_ORDER.reduce((s, id) => s + p.mods[id].owned.filter((m) => m !== STANDARD).length, 0);

export const selectedMods = (p: Progress): Record<WeaponId, string> =>
  Object.fromEntries(WEAPON_ORDER.map((id) => [id, p.mods[id].selected])) as Record<WeaponId, string>;

// ---------- Bộ súng mang vào trận ----------
/** Bộ súng theo chế độ đã chọn (dùng cho cả online: mỗi người gửi lựa chọn của mình). */
export function loadoutFromMods(mods: Partial<Record<WeaponId, string>>): WeaponDef[] {
  return WEAPON_ORDER.map((id) => buildWeapon(id, mods[id] ?? STANDARD));
}

export const playerLoadout = (p: Progress) => loadoutFromMods(selectedMods(p));
export const standardLoadout = () => loadoutFromMods({});

/** Bot không dùng Sniper (với độ chính xác của máy sẽ quá khó chịu). */
export function botLoadout(): WeaponDef[] {
  return (['pistol', 'smg', 'shotgun', 'rifle'] as WeaponId[]).map((id) => buildWeapon(id));
}

// ---------- Thành tựu ----------
export interface MatchContext {
  kind: MatchKind;
  won: boolean;
  lost: boolean;
  myRounds: number;
  oppRounds: number;
  roundWinners: (0 | 1 | null)[]; // 0 = đội mình
  flawlessRound: boolean;
  accuracy: number;
  kills: number;
}

export interface AchievementDef {
  id: string; name: string; desc: string; reward: number;
  check?: (c: MatchContext, p: Progress) => boolean;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_win', name: 'Chiến thắng đầu tiên', desc: 'Thắng 1 trận bất kỳ', reward: 50, check: (c) => c.won },
  { id: 'flawless', name: 'Không tì vết', desc: 'Thắng 1 round mà không mất giọt máu nào', reward: 100, check: (c) => c.flawlessRound },
  { id: 'perfect', name: 'Hủy diệt', desc: 'Thắng trận với tỉ số 3:0', reward: 150, check: (c) => c.won && c.oppRounds === 0 },
  { id: 'sharpshooter', name: 'Xạ thủ', desc: 'Thắng trận với độ chính xác từ 60%', reward: 120, check: (c) => c.won && c.accuracy >= 0.6 },
  {
    id: 'comeback', name: 'Lội ngược dòng', desc: 'Thắng trận sau khi bị dẫn 0:2', reward: 200,
    check: (c) => {
      if (!c.won) return false;
      let me = 0, op = 0;
      for (const w of c.roundWinners) {
        if (w === 0) me++; else if (w === 1) op++;
        if (me === 0 && op === 2) return true;
      }
      return false;
    },
  },
  { id: 'streak3', name: 'Chuỗi thắng', desc: 'Thắng 3 trận liên tiếp', reward: 150, check: (_c, p) => p.winStreak >= 3 },
  { id: 'win_hard', name: 'Kẻ hạ gục máy', desc: 'Thắng Bot Khó', reward: 300, check: (c) => c.won && c.kind === 'hard' },
  { id: 'online_win', name: 'Bất bại online', desc: 'Thắng 1 trận online', reward: 200, check: (c) => c.won && c.kind === 'online' },
  { id: 'kills100', name: 'Trăm trận trăm thắng', desc: 'Tổng cộng 100 lần hạ gục', reward: 250, check: (_c, p) => p.totalKills >= 100 },
  { id: 'collector', name: 'Nhà sưu tầm', desc: 'Sở hữu 6 chế độ súng', reward: 300 },
];

function grant(p: Progress, _ids: string[], test: (a: AchievementDef) => boolean): AchievementDef[] {
  const got = ACHIEVEMENTS.filter((a) => !p.achievements.includes(a.id) && test(a));
  for (const a of got) { p.achievements.push(a.id); p.coins += a.reward; }
  return got;
}

// ---------- Thưởng sau trận ----------
const KIND_MULT: Record<MatchKind, number> = { easy: 0.6, normal: 1, hard: 1.5, online: 1.3 };

export interface Rewards { coins: number; xp: number; levelBefore: number; levelAfter: number; achievements: AchievementDef[] }

function addXp(p: Progress, xp: number) {
  p.xp += xp;
  while (p.xp >= xpToNext(p.level)) {
    p.xp -= xpToNext(p.level);
    p.level++;
  }
}

export function applyMatch(p: Progress, c: MatchContext): Rewards {
  const levelBefore = p.level;
  p.totalKills += c.kills;
  if (c.won) {
    p.winStreak++;
    if (c.kind === 'online') p.onlineWins++;
    else p.winsByDiff[c.kind]++;
  } else {
    p.winStreak = 0;
  }

  const base = c.won ? 80 : c.lost ? 25 : 40;
  const matchCoins = Math.round((base + c.kills * 12 + c.myRounds * 8 + (c.accuracy >= 0.5 ? 20 : 0)) * KIND_MULT[c.kind]);
  const coinsBefore = p.coins;
  const achievements = grant(p, [], (a) => !!a.check?.(c, p));
  const bonus = p.coins - coinsBefore;
  p.coins += matchCoins;
  addXp(p, matchCoins);
  return { coins: matchCoins + bonus, xp: matchCoins, levelBefore, levelAfter: p.level, achievements };
}
