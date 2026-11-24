import { WEAPON_ORDER, MAX_LEVEL, UPGRADES, buildWeapon, type WeaponDef, type WeaponId } from './game/weapons';
import {
  ACHIEVEMENTS, UNLOCKS, nextUpgrade, reqMet, reqText, upgradeBlocker, xpToNext, type Progress,
} from './progression';

/** Giao diện Kho vũ khí: danh sách súng bên trái, chi tiết + lộ trình nâng cấp bên phải. */

export const WEAPON_ROLE: Record<WeaponId, string> = {
  pistol: 'Súng lục ổn định, chính xác ở mọi tầm. Băng đạn vừa, nạp nhanh.',
  smg: 'Bắn cực nhanh, sát thương mỗi viên thấp, đạn tỏa. Mạnh ở tầm gần – trung.',
  shotgun: 'Mỗi phát bắn ra nhiều viên. Cực mạnh khi áp sát, gần như vô dụng ở xa.',
  rifle: 'Cân bằng: bắn nhanh, chính xác, tầm xa. Lựa chọn an toàn cho mọi tình huống.',
  sniper: 'Một phát cực đau, bắn rất chậm. Trượt là trả giá — cần ngắm thật chuẩn.',
};

/** Hình súng đơn giản bằng SVG. */
const SHAPES: Record<WeaponId, string> = {
  pistol: '<rect x="14" y="5" width="30" height="7" rx="1"/><polygon points="16,12 25,12 22,22 13,22"/><rect x="26" y="12" width="5" height="3"/>',
  smg: '<rect x="8" y="6" width="42" height="7" rx="1"/><rect x="50" y="8" width="8" height="3"/><rect x="28" y="13" width="6" height="10"/><polygon points="14,13 21,13 18,21 11,21"/><rect x="0" y="7" width="8" height="4"/>',
  shotgun: '<rect x="30" y="6" width="34" height="4"/><rect x="12" y="6" width="22" height="8" rx="1"/><rect x="38" y="10" width="16" height="5" rx="1"/><polygon points="0,9 12,6 12,14 0,18"/><polygon points="16,14 22,14 20,20 14,20"/>',
  rifle: '<rect x="40" y="7" width="24" height="3"/><rect x="12" y="5" width="30" height="8" rx="1"/><polygon points="25,13 31,13 34,22 28,22"/><polygon points="0,6 12,5 12,13 0,16"/><polygon points="16,13 21,13 19,19 14,19"/>',
  sniper: '<rect x="36" y="8" width="28" height="2.5"/><rect x="12" y="6" width="26" height="7" rx="1"/><rect x="17" y="1" width="16" height="4" rx="2"/><rect x="21" y="5" width="2" height="2"/><rect x="27" y="5" width="2" height="2"/><polygon points="0,5 12,6 12,13 0,17"/><polygon points="16,13 21,13 19,20 14,20"/>',
};

export function weaponIcon(id: WeaponId, cls = 'gun'): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 64 24');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = SHAPES[id];
  return svg;
}

// ---------- Thanh chỉ số ----------
interface StatDef {
  label: string;
  value: (w: WeaponDef) => number;
  format: (w: WeaponDef) => string;
  lowerIsBetter?: boolean;
}

const dps = (w: WeaponDef) => w.damage * w.pellets * w.fireRate;

const STATS: StatDef[] = [
  { label: 'Sát thương / giây', value: dps, format: (w) => String(Math.round(dps(w))) },
  { label: 'Sát thương / phát', value: (w) => w.damage * w.pellets, format: (w) => (w.pellets > 1 ? `${w.damage} × ${w.pellets}` : String(w.damage)) },
  { label: 'Tốc độ bắn', value: (w) => w.fireRate, format: (w) => `${w.fireRate.toFixed(1)}/s` },
  { label: 'Băng đạn', value: (w) => w.mag, format: (w) => String(w.mag) },
  { label: 'Nạp đạn', value: (w) => w.reload, format: (w) => `${w.reload.toFixed(2)}s`, lowerIsBetter: true },
  { label: 'Tầm bắn', value: (w) => w.range, format: (w) => String(Math.round(w.range)) },
];

/** Thang đo chung cho mọi súng để thanh có thể so sánh với nhau. */
const SCALE = STATS.map((s) => {
  const all = WEAPON_ORDER.flatMap((id) => [1, MAX_LEVEL].map((l) => s.value(buildWeapon(id, l))));
  return { min: Math.min(...all), max: Math.max(...all) };
});

function pct(i: number, w: WeaponDef): number {
  const s = STATS[i], { min, max } = SCALE[i];
  const v = s.value(w);
  // Nạp đạn: càng nhanh thanh càng dài
  const k = s.lowerIsBetter ? (max - v) / (max - min) : v / max;
  return Math.max(4, Math.min(100, k * 100));
}

// ---------- DOM helpers ----------
function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function stars(level: number): HTMLElement {
  const s = h('span', 'stars');
  for (let i = 1; i <= MAX_LEVEL; i++) s.append(h('span', i <= level ? '' : 'off', '★'));
  return s;
}

export function renderProfile(target: HTMLElement, p: Progress) {
  const need = xpToNext(p.level);
  const bar = h('div', 'xpbar');
  const fill = h('i');
  fill.style.width = `${Math.round((p.xp / need) * 100)}%`;
  bar.append(fill);
  target.replaceChildren(
    h('span', 'lvl', `Cấp ${p.level}`),
    bar,
    h('span', 'xptext', `${p.xp}/${need} XP`),
    h('span', 'coins', `💰 ${p.coins} xu`),
  );
}

// ---------- Kho vũ khí ----------
export interface ArmoryHooks {
  getProgress: () => Progress;
  onUpgrade: (id: WeaponId) => void;
}

export class Armory {
  private selected: WeaponId = 'pistol';
  private tab: 'weapons' | 'achievements' = 'weapons';

  constructor(private root: HTMLElement, private hooks: ArmoryHooks) {
    root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) =>
      b.addEventListener('click', () => {
        this.tab = b.dataset.tab as 'weapons' | 'achievements';
        this.render();
      }));
  }

  render() {
    const p = this.hooks.getProgress();
    renderProfile(this.root.querySelector<HTMLElement>('#armory-profile')!, p);

    this.root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === this.tab));
    this.root.querySelector('#tab-weapons')!.classList.toggle('hidden', this.tab !== 'weapons');
    this.root.querySelector('#tab-achievements')!.classList.toggle('hidden', this.tab !== 'achievements');
    this.root.querySelector('#ach-count')!.textContent = `${p.achievements.length}/${ACHIEVEMENTS.length}`;

    this.renderList(p);
    this.renderDetail(p);
    this.renderAchievements(p);
  }

  private renderList(p: Progress) {
    const list = this.root.querySelector('#weapon-list')!;
    list.replaceChildren(...WEAPON_ORDER.map((id) => {
      const wp = p.weapons[id];
      const tile = h('button', `wtile${id === this.selected ? ' selected' : ''}${wp.unlocked ? '' : ' locked'}`);
      tile.type = 'button';
      tile.append(weaponIcon(id));
      const info = h('div', 'wtile-info');
      info.append(h('div', 'wtile-name', buildWeapon(id).name));
      info.append(wp.unlocked ? stars(wp.level) : h('span', 'wtile-lock', '🔒 Chưa mở khóa'));
      tile.append(info);
      if (wp.unlocked && !upgradeBlocker(p, id)) tile.append(h('span', 'dot', ''));
      tile.addEventListener('click', () => { this.selected = id; this.render(); });
      return tile;
    }));
  }

  private renderDetail(p: Progress) {
    const id = this.selected;
    const wp = p.weapons[id];
    const cur = buildWeapon(id, wp.level);
    const next = wp.unlocked && wp.level < MAX_LEVEL ? buildWeapon(id, wp.level + 1) : null;
    const box = this.root.querySelector('#weapon-detail')!;
    box.replaceChildren();

    // Đầu trang: hình súng + tên + mô tả
    const head = h('div', 'wd-head');
    head.append(weaponIcon(id, 'gun big'));
    const title = h('div');
    const nameRow = h('div', 'wd-name');
    nameRow.append(h('span', '', cur.name), wp.unlocked ? stars(wp.level) : h('span', 'badge', '🔒 Khóa'));
    title.append(nameRow, h('p', 'wd-role', WEAPON_ROLE[id]));
    if (wp.unlocked) title.append(h('div', 'wd-kills', `Đã hạ gục ${wp.kills} đối thủ bằng súng này`));
    head.append(title);
    box.append(head);

    // Thanh chỉ số (vạch xanh = phần tăng thêm ở cấp sau)
    const stats = h('div', 'wd-stats');
    STATS.forEach((s, i) => {
      const row = h('div', 'stat-row');
      const label = h('span', 'stat-label', s.label);
      const bar = h('div', 'stat-bar');
      const fill = h('i');
      fill.style.width = `${pct(i, cur)}%`;
      bar.append(fill);
      let valueText = s.format(cur);
      let up = false;
      if (next) {
        const a = s.format(cur), b = s.format(next);
        if (a !== b) {
          up = true;
          const gain = h('b');
          gain.style.left = `${pct(i, cur)}%`;
          gain.style.width = `${Math.max(1.5, pct(i, next) - pct(i, cur))}%`;
          bar.append(gain);
          valueText = `${a} → ${b}`;
        }
      }
      row.append(label, bar, h('span', `stat-val${up ? ' up' : ''}`, valueText));
      stats.append(row);
    });
    if (cur.lifesteal > 0) {
      const row = h('div', 'stat-row');
      row.append(h('span', 'stat-label', 'Hút máu'), h('div'), h('span', 'stat-val', `${Math.round(cur.lifesteal * 100)}%`));
      stats.append(row);
    }
    box.append(stats);

    // Chưa mở khóa
    if (!wp.unlocked) {
      const u = UNLOCKS[id]!;
      const v = Math.min(u.current(p), u.target);
      const lock = h('div', 'wd-unlock');
      lock.append(h('div', 'wd-section', 'Điều kiện mở khóa'), h('div', 'wd-unlock-text', u.desc));
      const bar = h('div', 'progressbar');
      const fill = h('i');
      fill.style.width = `${(v / u.target) * 100}%`;
      bar.append(fill);
      lock.append(bar, h('div', 'req', `Tiến độ ${v}/${u.target}`));
      box.append(lock);
      return;
    }

    // Lộ trình nâng cấp
    box.append(h('div', 'wd-section', 'Lộ trình nâng cấp'));
    const path = h('ol', 'upath');
    UPGRADES[id].forEach((u, i) => {
      const lvl = i + 2;
      const state = lvl <= wp.level ? 'done' : lvl === wp.level + 1 ? 'next' : 'future';
      const li = h('li', `ustep ${state}`);
      const mark = h('span', 'umark', state === 'done' ? '✓' : String(lvl));
      const body = h('div', 'ubody');
      const top = h('div', 'utop');
      top.append(h('span', 'ulvl', `Cấp ${lvl}`), h('span', 'ucost', state === 'done' ? 'Đã có' : `${u.cost} xu`));
      body.append(top, h('div', 'udesc', u.desc));
      if (state !== 'done' && u.req.length) {
        const reqs = h('div', 'ureqs');
        for (const r of u.req) {
          const ok = reqMet(p, id, r);
          reqs.append(h('span', `chip ${ok ? 'ok' : 'no'}`, `${ok ? '✓' : '✗'} ${reqText(p, id, r)}`));
        }
        body.append(reqs);
      }
      li.append(mark, body);
      path.append(li);
    });
    box.append(path);

    // Nút nâng cấp
    const up = nextUpgrade(p, id);
    const blocker = upgradeBlocker(p, id);
    const btn = h('button', `upgrade-btn${blocker ? '' : ' primary'}`);
    btn.type = 'button';
    if (!up) {
      btn.textContent = '✨ Đã đạt cấp tối đa';
      btn.disabled = true;
    } else if (blocker) {
      btn.textContent = blocker === 'Không đủ xu' ? `Thiếu ${up.cost - p.coins} xu` : blocker;
      btn.disabled = true;
    } else {
      btn.textContent = `Nâng lên cấp ${wp.level + 1} · ${up.cost} xu`;
      btn.addEventListener('click', () => this.hooks.onUpgrade(id));
    }
    box.append(btn);
  }

  private renderAchievements(p: Progress) {
    const list = this.root.querySelector('#achievement-list')!;
    list.replaceChildren(...ACHIEVEMENTS.map((a) => {
      const done = p.achievements.includes(a.id);
      const div = h('div', `ach${done ? ' done' : ''}`);
      const top = h('div', 'ach-top');
      top.append(h('span', 'n', `${done ? '🏆' : '🔒'} ${a.name}`), h('span', 'r', `+${a.reward} xu`));
      div.append(top, h('div', 'd', a.desc));
      return div;
    }));
  }
}
