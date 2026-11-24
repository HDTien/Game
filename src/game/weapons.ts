export type WeaponId = 'pistol' | 'smg' | 'shotgun' | 'rifle' | 'sniper';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  level: number;
  damage: number;      // mỗi viên
  fireRate: number;    // phát / giây
  mag: number;
  reload: number;      // giây
  pellets: number;     // số viên mỗi lần bắn
  spread: number;      // radian
  bulletSpeed: number; // px / giây
  range: number;       // px
  gunLength: number;   // để vẽ
  lifesteal: number;   // tỉ lệ hồi máu theo sát thương gây ra
}

type BaseDef = Omit<WeaponDef, 'level'>;

export const WEAPON_ORDER: WeaponId[] = ['pistol', 'smg', 'shotgun', 'rifle', 'sniper'];

export const BASE_WEAPONS: Record<WeaponId, BaseDef> = {
  pistol:  { id: 'pistol',  name: 'Pistol',  damage: 20, fireRate: 3,   mag: 12, reload: 1.2, pellets: 1, spread: 0.03,  bulletSpeed: 950,  range: 950,  gunLength: 22, lifesteal: 0 },
  smg:     { id: 'smg',     name: 'SMG',     damage: 10, fireRate: 10,  mag: 30, reload: 2.0, pellets: 1, spread: 0.12,  bulletSpeed: 850,  range: 700,  gunLength: 26, lifesteal: 0 },
  shotgun: { id: 'shotgun', name: 'Shotgun', damage: 8,  fireRate: 1.1, mag: 6,  reload: 2.5, pellets: 6, spread: 0.32,  bulletSpeed: 800,  range: 380,  gunLength: 30, lifesteal: 0 },
  rifle:   { id: 'rifle',   name: 'Rifle',   damage: 15, fireRate: 6,   mag: 24, reload: 1.8, pellets: 1, spread: 0.05,  bulletSpeed: 1000, range: 900,  gunLength: 32, lifesteal: 0 },
  sniper:  { id: 'sniper',  name: 'Sniper',  damage: 65, fireRate: 0.8, mag: 4,  reload: 2.6, pellets: 1, spread: 0.004, bulletSpeed: 1800, range: 1400, gunLength: 40, lifesteal: 0 },
};

/** Các chỉ số cộng dồn theo tỉ lệ (0.1 = +10%), riêng pellets/lifesteal cộng thẳng. */
export interface Mods {
  damage?: number; fireRate?: number; mag?: number; reload?: number; spread?: number;
  bulletSpeed?: number; range?: number; pellets?: number; lifesteal?: number;
}

export type Requirement =
  | { kind: 'playerLevel'; value: number }
  | { kind: 'weaponKills'; value: number };

export interface UpgradeDef { cost: number; desc: string; mods: Mods; req: Requirement[] }

export const MAX_LEVEL = 5;

/** Cấp 2 → 5. Cấp càng cao càng cần nhiều xu và điều kiện khó hơn. */
const track = (special: { desc: string; mods: Mods }): UpgradeDef[] => [
  { cost: 100, desc: '+10% sát thương', mods: { damage: 0.1 }, req: [] },
  { cost: 250, desc: '+25% băng đạn, nạp nhanh hơn 10%', mods: { mag: 0.25, reload: -0.1 }, req: [{ kind: 'playerLevel', value: 3 }] },
  { cost: 500, desc: '+10% sát thương, +10% tốc độ bắn', mods: { damage: 0.1, fireRate: 0.1 }, req: [{ kind: 'weaponKills', value: 15 }] },
  { cost: 1000, desc: special.desc, mods: special.mods, req: [{ kind: 'weaponKills', value: 40 }, { kind: 'playerLevel', value: 8 }] },
];

export const UPGRADES: Record<WeaponId, UpgradeDef[]> = {
  pistol:  track({ desc: 'Băng đạn đôi: x2 băng đạn, +10% sát thương', mods: { mag: 1, damage: 0.1 } }),
  smg:     track({ desc: 'Hút máu: hồi máu bằng 20% sát thương gây ra', mods: { lifesteal: 0.2 } }),
  shotgun: track({ desc: 'Đạn chùm: +2 viên mỗi phát', mods: { pellets: 2 } }),
  rifle:   track({ desc: 'Nòng ổn định: giảm 50% độ tỏa, đạn bay nhanh hơn 25%', mods: { spread: -0.5, bulletSpeed: 0.25 } }),
  sniper:  track({ desc: 'Lên đạn nhanh: nạp và bắn nhanh hơn 30%', mods: { reload: -0.3, fireRate: 0.3 } }),
};

export function buildWeapon(id: WeaponId, level = 1): WeaponDef {
  const b = BASE_WEAPONS[id];
  const s: Required<Mods> = { damage: 0, fireRate: 0, mag: 0, reload: 0, spread: 0, bulletSpeed: 0, range: 0, pellets: 0, lifesteal: 0 };
  for (const u of UPGRADES[id].slice(0, Math.max(0, level - 1))) {
    for (const k of Object.keys(u.mods) as (keyof Mods)[]) s[k] += u.mods[k] ?? 0;
  }
  return {
    ...b,
    level,
    damage: Math.round(b.damage * (1 + s.damage)),
    fireRate: b.fireRate * (1 + s.fireRate),
    mag: Math.round(b.mag * (1 + s.mag)),
    reload: b.reload * (1 + s.reload),
    pellets: b.pellets + s.pellets,
    spread: b.spread * (1 + s.spread),
    bulletSpeed: b.bulletSpeed * (1 + s.bulletSpeed),
    range: b.range * (1 + s.range),
    lifesteal: b.lifesteal + s.lifesteal,
  };
}
