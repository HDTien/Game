export type PickupKind = 'health' | 'armor' | 'damage' | 'speed' | 'ammo';

export interface PickupInfo { label: string; symbol: string; color: string; weight: number }

export const PICKUPS: Record<PickupKind, PickupInfo> = {
  health: { label: '+40 Máu',        symbol: '+', color: '#06d6a0', weight: 3 },
  armor:  { label: '+50 Giáp',       symbol: '◆', color: '#4895ef', weight: 2 },
  damage: { label: 'Sát thương x1.3', symbol: '!', color: '#ff6b35', weight: 2 },
  speed:  { label: 'Tốc độ +35%',    symbol: '»', color: '#ffd166', weight: 2 },
  ammo:   { label: 'Đầy đạn + lướt',  symbol: '≡', color: '#c77dff', weight: 1 },
};

export const PICKUP_R = 12;
export const PICKUP_FIRST = 6;     // giây sau khi bắt đầu round
export const PICKUP_INTERVAL = 12; // giây giữa các đợt
export const MAX_PICKUPS = 4;
export const HEAL_AMOUNT = 40;
export const ARMOR_AMOUNT = 50;
export const MAX_ARMOR = 50;
export const BOOST_TIME = 8;
export const DAMAGE_MULT = 1.3;
export const SPEED_MULT = 1.35;

export function randomPickupKind(): PickupKind {
  const entries = Object.entries(PICKUPS) as [PickupKind, PickupInfo][];
  let r = Math.random() * entries.reduce((s, [, v]) => s + v.weight, 0);
  for (const [k, v] of entries) {
    r -= v.weight;
    if (r <= 0) return k;
  }
  return 'health';
}
