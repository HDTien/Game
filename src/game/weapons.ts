export type WeaponId = 'pistol' | 'smg' | 'shotgun' | 'rifle' | 'sniper';
export type Tracer = 'normal' | 'faint' | 'heavy';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  modId: string;
  modName: string;
  damage: number;      // mỗi viên
  fireRate: number;    // lần bóp cò / giây
  mag: number;
  reload: number;      // giây
  pellets: number;     // số viên mỗi phát
  spread: number;      // radian
  bulletSpeed: number; // px / giây
  range: number;       // px
  burst: number;       // số phát mỗi lần bóp cò (loạt)
  burstGap: number;    // giây giữa các phát trong loạt
  bounces: number;     // số lần đạn nảy khỏi tường
  pierce: number;      // số bức tường đạn xuyên qua được
  moveMult: number;    // hệ số tốc độ chạy khi cầm súng
  tracer: Tracer;
  gunLength: number;
  lifesteal: number;
}

type Stats = Omit<WeaponDef, 'id' | 'name' | 'modId' | 'modName'>;

export const WEAPON_ORDER: WeaponId[] = ['pistol', 'smg', 'shotgun', 'rifle', 'sniper'];

const DEFAULTS: Pick<Stats, 'burst' | 'burstGap' | 'bounces' | 'pierce' | 'moveMult' | 'tracer' | 'lifesteal'> = {
  burst: 1, burstGap: 0.07, bounces: 0, pierce: 0, moveMult: 1, tracer: 'normal', lifesteal: 0,
};

export const BASE_WEAPONS: Record<WeaponId, { name: string; stats: Stats }> = {
  pistol:  { name: 'Pistol',  stats: { ...DEFAULTS, damage: 20, fireRate: 3,   mag: 12, reload: 1.2, pellets: 1, spread: 0.03,  bulletSpeed: 950,  range: 950,  gunLength: 22 } },
  smg:     { name: 'SMG',     stats: { ...DEFAULTS, damage: 10, fireRate: 10,  mag: 30, reload: 2.0, pellets: 1, spread: 0.12,  bulletSpeed: 850,  range: 700,  gunLength: 26 } },
  shotgun: { name: 'Shotgun', stats: { ...DEFAULTS, damage: 8,  fireRate: 1.1, mag: 6,  reload: 2.5, pellets: 6, spread: 0.32,  bulletSpeed: 800,  range: 380,  gunLength: 30 } },
  rifle:   { name: 'Rifle',   stats: { ...DEFAULTS, damage: 15, fireRate: 6,   mag: 24, reload: 1.8, pellets: 1, spread: 0.05,  bulletSpeed: 1000, range: 900,  gunLength: 32 } },
  sniper:  { name: 'Sniper',  stats: { ...DEFAULTS, damage: 65, fireRate: 0.8, mag: 4,  reload: 2.6, pellets: 1, spread: 0.004, bulletSpeed: 1800, range: 1400, gunLength: 40, moveMult: 0.92 } },
};

/**
 * Chế độ súng: đánh đổi, KHÔNG mạnh hơn tổng thể.
 * Quy tắc cân bằng: mọi chế độ có thời gian hạ gục (100 máu, trúng hết) trong khoảng ~0.8–1.4 giây,
 * và không viên nào gây ≥ 100 sát thương (không hạ 1 phát từ đầy máu).
 */
export interface ModDef {
  id: string;
  name: string;
  desc: string;
  pros: string[];
  cons: string[];
  cost: number;     // xu để mở
  reqLevel: number; // cấp người chơi tối thiểu
  stats: Partial<Stats>;
}

export const STANDARD = 'standard';

export const MODS: Record<WeaponId, ModDef[]> = {
  pistol: [
    { id: STANDARD, name: 'Tiêu chuẩn', desc: 'Cân bằng, chính xác, nạp nhanh.', pros: [], cons: [], cost: 0, reqLevel: 1, stats: {} },
    {
      id: 'magnum', name: 'Magnum', desc: 'Đạn cỡ lớn: 3 phát hạ gục nhưng bắn chậm, băng ít.',
      pros: ['Sát thương 34', 'Rất chính xác'], cons: ['Bắn chậm', 'Băng 6 viên'], cost: 150, reqLevel: 1,
      stats: { damage: 34, fireRate: 1.6, mag: 6, reload: 1.6, spread: 0.015, bulletSpeed: 1100, range: 1000, tracer: 'heavy' },
    },
    {
      id: 'burst', name: 'Bắn loạt', desc: 'Mỗi lần bóp cò bắn loạt 3 viên.',
      pros: ['Loạt 3 viên', 'Băng 18'], cons: ['Mỗi viên yếu hơn', 'Tỏa hơn'], cost: 200, reqLevel: 3,
      stats: { damage: 14, fireRate: 2.2, burst: 3, burstGap: 0.07, mag: 18, reload: 1.4, spread: 0.05 },
    },
    {
      id: 'akimbo', name: 'Song súng', desc: 'Hai khẩu cùng lúc: xả đạn nhanh nhưng khó trúng.',
      pros: ['Bắn rất nhanh', 'Băng 24'], cons: ['Đạn tỏa mạnh', 'Nạp chậm'], cost: 250, reqLevel: 5,
      stats: { damage: 15, fireRate: 5.5, mag: 24, reload: 2.4, spread: 0.1 },
    },
  ],
  smg: [
    { id: STANDARD, name: 'Tiêu chuẩn', desc: 'Xả đạn nhanh, mạnh ở tầm gần – trung.', pros: [], cons: [], cost: 0, reqLevel: 1, stats: {} },
    {
      id: 'silencer', name: 'Giảm thanh', desc: 'Tiếng bắn nhỏ, vệt đạn gần như vô hình — khó bị phát hiện.',
      pros: ['Vệt đạn mờ', 'Tiếng nhỏ', 'Ít tỏa hơn'], cons: ['Sát thương 9'], cost: 200, reqLevel: 1,
      stats: { damage: 9, spread: 0.09, tracer: 'faint' },
    },
    {
      id: 'drum', name: 'Băng trống', desc: 'Băng 60 viên, xả liên tục không nghỉ.',
      pros: ['Băng 60 viên'], cons: ['Nạp rất chậm', 'Chạy chậm 10%'], cost: 150, reqLevel: 2,
      stats: { mag: 60, reload: 3.4, moveMult: 0.9 },
    },
    {
      id: 'vector', name: 'Cuồng phong', desc: 'Tốc độ bắn cực cao nhưng tầm ngắn.',
      pros: ['16 phát/giây'], cons: ['Mỗi viên yếu', 'Tầm 500', 'Tỏa mạnh'], cost: 300, reqLevel: 4,
      stats: { damage: 7, fireRate: 16, mag: 32, reload: 1.8, spread: 0.16, range: 500 },
    },
  ],
  shotgun: [
    { id: STANDARD, name: 'Tiêu chuẩn', desc: '6 viên mỗi phát, mạnh khi áp sát.', pros: [], cons: [], cost: 0, reqLevel: 1, stats: {} },
    {
      id: 'slug', name: 'Đạn chì', desc: 'Một viên đạn đặc: biến shotgun thành súng tầm trung.',
      pros: ['Chính xác', 'Tầm 750'], cons: ['Chỉ 1 viên', 'Cần ngắm chuẩn'], cost: 150, reqLevel: 1,
      stats: { pellets: 1, damage: 42, spread: 0.015, range: 750, bulletSpeed: 1000, fireRate: 1.3, mag: 5, tracer: 'heavy' },
    },
    {
      id: 'sawed', name: 'Nòng cưa', desc: 'Hai phát liên tiếp cực mạnh ở cự ly sát, rồi phải nạp.',
      pros: ['9 viên', 'Bắn nhanh', 'Chạy nhanh 8%'], cons: ['Tầm 240', 'Băng 2'], cost: 250, reqLevel: 3,
      stats: { pellets: 9, damage: 6, spread: 0.6, range: 240, mag: 2, fireRate: 2, reload: 1.8, moveMult: 1.08 },
    },
    {
      id: 'auto', name: 'Tự động', desc: 'Shotgun liên thanh: bắn nhanh hơn, mỗi viên nhẹ hơn.',
      pros: ['2.4 phát/giây', 'Băng 8'], cons: ['Mỗi viên 6', 'Tỏa hơn', 'Nạp chậm'], cost: 300, reqLevel: 5,
      stats: { damage: 6, fireRate: 2.4, mag: 8, reload: 2.8, spread: 0.38 },
    },
  ],
  rifle: [
    { id: STANDARD, name: 'Tiêu chuẩn', desc: 'Tự động, chính xác, tầm xa.', pros: [], cons: [], cost: 0, reqLevel: 1, stats: {} },
    {
      id: 'burst', name: 'Loạt 3 viên', desc: 'Bắn loạt 3 viên chính xác.',
      pros: ['Loạt 3 viên', 'Ít tỏa'], cons: ['Nghỉ giữa các loạt'], cost: 200, reqLevel: 2,
      stats: { damage: 14, fireRate: 2.6, burst: 3, burstGap: 0.06, spread: 0.03 },
    },
    {
      id: 'marksman', name: 'Bán tự động', desc: 'Súng trường bắn tỉa: 4 phát hạ gục.',
      pros: ['Sát thương 30', 'Đạn nhanh', 'Tầm 1100'], cons: ['Bắn chậm', 'Băng 12'], cost: 250, reqLevel: 3,
      stats: { damage: 30, fireRate: 2.4, mag: 12, spread: 0.012, range: 1100, bulletSpeed: 1300, tracer: 'heavy' },
    },
    {
      id: 'ricochet', name: 'Đạn nảy', desc: 'Đạn nảy 1 lần khi chạm tường — bắn được qua góc khuất.',
      pros: ['Đạn nảy khỏi tường'], cons: ['Sát thương 13'], cost: 300, reqLevel: 6,
      stats: { damage: 13, bounces: 1 },
    },
  ],
  sniper: [
    { id: STANDARD, name: 'Tiêu chuẩn', desc: '2 phát hạ gục, bắn rất chậm.', pros: [], cons: [], cost: 0, reqLevel: 1, stats: {} },
    {
      id: 'hunter', name: 'Săn mồi', desc: 'Nhẹ và nhanh hơn, cần 3 phát.',
      pros: ['Bắn nhanh gấp đôi', 'Băng 6', 'Chạy bình thường'], cons: ['Sát thương 45'], cost: 200, reqLevel: 2,
      stats: { damage: 45, fireRate: 1.5, mag: 6, reload: 2.0, moveMult: 1 },
    },
    {
      id: 'pierce', name: 'Xuyên tường', desc: 'Đạn xuyên qua 1 bức tường (mất 30% sát thương).',
      pros: ['Xuyên 1 tường'], cons: ['Sát thương 55', 'Băng 3', 'Bắn chậm hơn'], cost: 300, reqLevel: 4,
      stats: { damage: 55, pierce: 1, fireRate: 0.7, mag: 3 },
    },
    {
      id: 'heavy', name: 'Hạng nặng', desc: 'Sát thương 90 — chỉ còn thiếu một chút là hạ 1 phát.',
      pros: ['Sát thương 90'], cons: ['Rất chậm', 'Băng 2', 'Chạy chậm 15%'], cost: 250, reqLevel: 6,
      stats: { damage: 90, fireRate: 0.5, mag: 2, reload: 3.2, moveMult: 0.85, tracer: 'heavy' },
    },
  ],
};

/** Không viên đạn nào được gây từ 100 sát thương trở lên (kể cả khi có buff). */
export const MAX_BULLET_DAMAGE = 95;

export function findMod(id: WeaponId, modId: string): ModDef {
  return MODS[id].find((m) => m.id === modId) ?? MODS[id][0];
}

export function buildWeapon(id: WeaponId, modId: string = STANDARD): WeaponDef {
  const base = BASE_WEAPONS[id];
  const mod = findMod(id, modId);
  return { id, name: base.name, modId: mod.id, modName: mod.name, ...base.stats, ...mod.stats };
}

/** Thời gian hạ gục lý thuyết (giây) khi mọi viên đều trúng — dùng để cân bằng. */
export function timeToKill(w: WeaponDef, hp = 100): number {
  const perShot = Math.min(w.damage, MAX_BULLET_DAMAGE) * w.pellets;
  let shots = Math.ceil(hp / perShot);
  let t = 0;
  let ammo = w.mag;
  let inBurst = 0;
  while (--shots > 0) {
    ammo--;
    if (ammo <= 0) { t += w.reload; ammo = w.mag; inBurst = 0; continue; }
    inBurst++;
    if (w.burst > 1 && inBurst < w.burst) t += w.burstGap;
    else { t += 1 / w.fireRate - (w.burst > 1 ? (w.burst - 1) * w.burstGap : 0); inBurst = 0; }
  }
  return t;
}
