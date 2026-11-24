import type { Difficulty } from './game/bot';
import {
  WEAPON_ORDER, UPGRADES, MAX_LEVEL, buildWeapon,
  type Requirement, type WeaponDef, type WeaponId,
} from './game/weapons';

/**
 * Hệ thống tiến trình: xu, kinh nghiệm, cấp độ, nâng cấp súng, mở khóa súng, thành tựu.
 * Chỉ nhận thưởng khi đấu với Bot (chế độ 2 người là giao hữu, dùng súng cơ bản cho công bằng).
 */

export interface WeaponProgress { unlocked: boolean; level: number; kills: number }

export interface Progress {
  coins: number;
  xp: number;    // kinh nghiệm trong cấp hiện tại
  level: number;
  weapons: Record<WeaponId, WeaponProgress>;
  achievements: string[];
  winStreak: number;
  winsByDiff: Record<Difficulty, number>;
  botKills: number;
}

export function defaultProgress(): Progress {
  const weapons = {} as Record<WeaponId, WeaponProgress>;
  for (const id of WEAPON_ORDER) weapons[id] = { unlocked: !UNLOCKS[id], level: 1, kills: 0 };
  return {
    coins: 0, xp: 0, level: 1, weapons, achievements: [], winStreak: 0,
    winsByDiff: { easy: 0, normal: 0, hard: 0 }, botKills: 0,
  };
}

export function normalizeProgress(raw: unknown): Progress {
  const d = defaultProgress();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<Progress>;
  const weapons = { ...d.weapons };
  for (const id of WEAPON_ORDER) weapons[id] = { ...d.weapons[id], ...r.weapons?.[id] };
  return {
    ...d,
    ...r,
    weapons,
    winsByDiff: { ...d.winsByDiff, ...r.winsByDiff },
    achievements: Array.isArray(r.achievements) ? r.achievements : [],
  };
}

export const xpToNext = (level: number) => 100 + 50 * (level - 1);

// ---------- Mở khóa súng ----------
export interface UnlockDef { desc: string; current: (p: Progress) => number; target: number }

export const UNLOCKS: Partial<Record<WeaponId, UnlockDef>> = {
  rifle: { desc: 'Thắng 3 trận với Bot Thường hoặc Khó', current: (p) => p.winsByDiff.normal + p.winsByDiff.hard, target: 3 },
  sniper: { desc: 'Thắng 1 trận với Bot Khó', current: (p) => p.winsByDiff.hard, target: 1 },
};

// ---------- Thành tựu ----------
export interface MatchContext {
  difficulty: Difficulty;
  won: boolean;
  lost: boolean;
  myRounds: number;
  oppRounds: number;
  roundWinners: (0 | 1 | null)[];
  flawlessRound: boolean; // thắng 1 round mà không nhận sát thương
  accuracy: number;
  kills: number;
  weaponKills: Partial<Record<WeaponId, number>>;
}

export interface AchievementDef {
  id: string; name: string; desc: string; reward: number;
  check?: (c: MatchContext, p: Progress) => boolean; // không có check → kiểm tra ở nơi khác
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_win', name: 'Chiến thắng đầu tiên', desc: 'Thắng 1 trận với Bot', reward: 50, check: (c) => c.won },
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
  { id: 'win_hard', name: 'Kẻ hạ gục máy', desc: 'Thắng Bot Khó', reward: 300, check: (c) => c.won && c.difficulty === 'hard' },
  { id: 'kills100', name: 'Trăm trận trăm thắng', desc: 'Tổng cộng 100 lần hạ gục Bot', reward: 250, check: (_c, p) => p.botKills >= 100 },
  { id: 'gunsmith', name: 'Thợ súng', desc: 'Nâng 1 khẩu súng lên cấp tối đa', reward: 300 },
];

// ---------- Thưởng sau trận ----------
const DIFF_MULT: Record<Difficulty, number> = { easy: 0.6, normal: 1, hard: 1.5 };

export interface Rewards {
  coins: number; xp: number; levelBefore: number; levelAfter: number;
  achievements: AchievementDef[]; unlocked: WeaponId[];
}

function addXp(p: Progress, xp: number) {
  p.xp += xp;
  while (p.xp >= xpToNext(p.level)) {
    p.xp -= xpToNext(p.level);
    p.level++;
  }
}

export function applyMatch(p: Progress, c: MatchContext): Rewards {
  const levelBefore = p.level;
  p.botKills += c.kills;
  for (const [id, n] of Object.entries(c.weaponKills) as [WeaponId, number][]) p.weapons[id].kills += n;
  if (c.won) { p.winStreak++; p.winsByDiff[c.difficulty]++; } else p.winStreak = 0;

  const base = c.won ? 80 : c.lost ? 25 : 40;
  const matchCoins = Math.round(
    (base + c.kills * 12 + c.myRounds * 8 + (c.accuracy >= 0.5 ? 20 : 0)) * DIFF_MULT[c.difficulty],
  );

  const achievements = ACHIEVEMENTS.filter((a) => !p.achievements.includes(a.id) && a.check?.(c, p));
  const bonus = achievements.reduce((s, a) => s + a.reward, 0);
  p.achievements.push(...achievements.map((a) => a.id));

  p.coins += matchCoins + bonus;
  addXp(p, matchCoins);

  const unlocked: WeaponId[] = [];
  for (const id of WEAPON_ORDER) {
    const u = UNLOCKS[id];
    if (u && !p.weapons[id].unlocked && u.current(p) >= u.target) {
      p.weapons[id].unlocked = true;
      unlocked.push(id);
    }
  }
  return { coins: matchCoins + bonus, xp: matchCoins, levelBefore, levelAfter: p.level, achievements, unlocked };
}

// ---------- Nâng cấp ----------
export function reqMet(p: Progress, id: WeaponId, r: Requirement): boolean {
  return r.kind === 'playerLevel' ? p.level >= r.value : p.weapons[id].kills >= r.value;
}

export function reqText(p: Progress, id: WeaponId, r: Requirement): string {
  return r.kind === 'playerLevel'
    ? `Cấp người chơi ${r.value} (hiện ${p.level})`
    : `Hạ ${r.value} đối thủ bằng súng này (${Math.min(p.weapons[id].kills, r.value)}/${r.value})`;
}

export function nextUpgrade(p: Progress, id: WeaponId) {
  const w = p.weapons[id];
  return w.level < MAX_LEVEL ? UPGRADES[id][w.level - 1] : null;
}

/** Trả về lý do không nâng cấp được, hoặc null nếu được. */
export function upgradeBlocker(p: Progress, id: WeaponId): string | null {
  const w = p.weapons[id];
  if (!w.unlocked) return 'Chưa mở khóa';
  const u = nextUpgrade(p, id);
  if (!u) return 'Đã đạt cấp tối đa';
  const missing = u.req.find((r) => !reqMet(p, id, r));
  if (missing) return 'Chưa đủ điều kiện';
  if (p.coins < u.cost) return 'Không đủ xu';
  return null;
}

/** Nâng cấp và trả về thành tựu mới đạt được (nếu có). */
export function upgradeWeapon(p: Progress, id: WeaponId): AchievementDef[] {
  if (upgradeBlocker(p, id)) return [];
  const u = nextUpgrade(p, id)!;
  p.coins -= u.cost;
  p.weapons[id].level++;
  const gained: AchievementDef[] = [];
  if (p.weapons[id].level === MAX_LEVEL && !p.achievements.includes('gunsmith')) {
    const a = ACHIEVEMENTS.find((x) => x.id === 'gunsmith')!;
    p.achievements.push(a.id);
    p.coins += a.reward;
    gained.push(a);
  }
  return gained;
}

// ---------- Bộ súng mang vào trận ----------
export function playerLoadout(p: Progress): WeaponDef[] {
  return WEAPON_ORDER.filter((id) => p.weapons[id].unlocked).map((id) => buildWeapon(id, p.weapons[id].level));
}

/** Bot dùng 3 súng cơ bản, cấp súng tăng theo độ khó. */
export function botLoadout(d: Difficulty): WeaponDef[] {
  const level = { easy: 1, normal: 2, hard: 3 }[d];
  return (['pistol', 'smg', 'shotgun'] as WeaponId[]).map((id) => buildWeapon(id, level));
}

/** Chế độ 2 người: cả hai dùng đủ 5 súng ở cấp 1. */
export function friendlyLoadout(): WeaponDef[] {
  return WEAPON_ORDER.map((id) => buildWeapon(id, 1));
}
