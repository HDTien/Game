import type { Difficulty } from './game/bot';

/**
 * Lưu dữ liệu trên trình duyệt (localStorage).
 * Mọi chỗ khác chỉ dùng interface DataStore → sau này thay bằng ApiStore (gọi backend + MongoDB)
 * mà không phải sửa game/UI.
 */

export type Mode = 'bot' | 'local';

export interface MatchPlayerRecord {
  name: string; score: number;
  kills: number; deaths: number; shots: number; hits: number; damage: number;
}

export interface MatchRecord {
  id: string;
  date: string; // ISO
  mode: Mode;
  difficulty?: Difficulty;
  mapId: string;
  mapName: string;
  players: [MatchPlayerRecord, MatchPlayerRecord];
  winner: 0 | 1 | null;
  rounds: number;
  durationSec: number;
}

export interface Settings {
  mode: Mode;
  difficulty: Difficulty;
  mapId: string;
  p2Name: string;
  volume: number; // 0..1
  screenShake: boolean;
}

export interface Totals {
  matches: number; wins: number; losses: number; draws: number;
  kills: number; deaths: number; shots: number; hits: number; damage: number;
}

export interface SaveData {
  version: 1;
  profile: { name: string };
  settings: Settings;
  stats: Totals;
  history: MatchRecord[];
}

export interface DataStore {
  load(): SaveData;
  save(data: SaveData): void;
  addMatch(rec: MatchRecord): SaveData;
  reset(): SaveData;
  exportJSON(): string;
  importJSON(text: string): SaveData;
}

const KEY = 'shooter1v1.save';
const MAX_HISTORY = 100;

export function defaults(): SaveData {
  return {
    version: 1,
    profile: { name: 'Người chơi 1' },
    settings: { mode: 'bot', difficulty: 'normal', mapId: 'warehouse', p2Name: 'Người chơi 2', volume: 0.5, screenShake: true },
    stats: { matches: 0, wins: 0, losses: 0, draws: 0, kills: 0, deaths: 0, shots: 0, hits: 0, damage: 0 },
    history: [],
  };
}

function normalize(raw: unknown): SaveData {
  const d = defaults();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<SaveData>;
  return {
    version: 1,
    profile: { ...d.profile, ...r.profile },
    settings: { ...d.settings, ...r.settings },
    stats: { ...d.stats, ...r.stats },
    history: Array.isArray(r.history) ? r.history.slice(0, MAX_HISTORY) : [],
  };
}

export class LocalStore implements DataStore {
  load(): SaveData {
    try {
      const text = localStorage.getItem(KEY);
      return text ? normalize(JSON.parse(text)) : defaults();
    } catch {
      return defaults();
    }
  }

  save(data: SaveData) {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      /* chế độ ẩn danh / bộ nhớ đầy: bỏ qua, game vẫn chạy */
    }
  }

  addMatch(rec: MatchRecord): SaveData {
    const data = this.load();
    data.history.unshift(rec);
    data.history = data.history.slice(0, MAX_HISTORY);
    // Thống kê tổng tính cho người chơi 1 (chủ hồ sơ)
    const me = rec.players[0], s = data.stats;
    s.matches++;
    if (rec.winner === 0) s.wins++;
    else if (rec.winner === 1) s.losses++;
    else s.draws++;
    s.kills += me.kills; s.deaths += me.deaths; s.shots += me.shots; s.hits += me.hits; s.damage += me.damage;
    this.save(data);
    return data;
  }

  reset(): SaveData {
    const data = this.load();
    const fresh = defaults();
    fresh.profile = data.profile;
    fresh.settings = data.settings;
    this.save(fresh);
    return fresh;
  }

  exportJSON(): string {
    return JSON.stringify(this.load(), null, 2);
  }

  importJSON(text: string): SaveData {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || (parsed as { version?: unknown }).version !== 1) {
      throw new Error('File không đúng định dạng dữ liệu game.');
    }
    const data = normalize(parsed);
    this.save(data);
    return data;
  }
}
