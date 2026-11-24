export interface WeaponDef {
  id: 'pistol' | 'smg' | 'shotgun';
  name: string;
  damage: number;      // mỗi viên
  fireRate: number;    // phát / giây
  mag: number;
  reload: number;      // giây
  pellets: number;     // số viên mỗi lần bắn
  spread: number;      // radian
  bulletSpeed: number; // px / giây
  range: number;       // px
  gunLength: number;   // để vẽ
}

export const WEAPONS: WeaponDef[] = [
  { id: 'pistol', name: 'Pistol', damage: 20, fireRate: 3, mag: 12, reload: 1.2, pellets: 1, spread: 0.03, bulletSpeed: 950, range: 950, gunLength: 22 },
  { id: 'smg', name: 'SMG', damage: 10, fireRate: 10, mag: 30, reload: 2.0, pellets: 1, spread: 0.12, bulletSpeed: 850, range: 700, gunLength: 26 },
  { id: 'shotgun', name: 'Shotgun', damage: 8, fireRate: 1.1, mag: 6, reload: 2.5, pellets: 6, spread: 0.32, bulletSpeed: 800, range: 380, gunLength: 30 },
];
