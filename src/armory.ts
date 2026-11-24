import { WEAPON_ORDER, MODS, MAX_BULLET_DAMAGE, buildWeapon, timeToKill, type WeaponDef, type WeaponId } from './game/weapons';
import { ACHIEVEMENTS, modBlocker, xpToNext, type Progress } from './progression';

/** Kho vũ khí: chọn chế độ cho từng súng. Mọi chế độ đều là đánh đổi, không chế độ nào mạnh hơn tuyệt đối. */

export const WEAPON_ROLE: Record<WeaponId, string> = {
  pistol: 'Súng lục ổn định, chính xác ở mọi tầm. Băng đạn vừa, nạp nhanh.',
  smg: 'Bắn cực nhanh, mỗi viên yếu, đạn tỏa. Mạnh ở tầm gần – trung.',
  shotgun: 'Mỗi phát nhiều viên. Cực mạnh khi áp sát, gần như vô dụng ở xa.',
  rifle: 'Cân bằng: bắn nhanh, chính xác, tầm xa. An toàn cho mọi tình huống.',
  sniper: 'Phát bắn cực đau nhưng rất chậm. Trượt là trả giá — cần ngắm chuẩn.',
};

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
interface StatDef { label: string; value: (w: WeaponDef) => number; format: (w: WeaponDef) => string; lowerIsBetter?: boolean }

const STATS: StatDef[] = [
  { label: 'Thời gian hạ gục', value: (w) => timeToKill(w), format: (w) => `${timeToKill(w).toFixed(2)}s`, lowerIsBetter: true },
  {
    label: 'Sát thương / phát', value: (w) => Math.min(w.damage, MAX_BULLET_DAMAGE) * w.pellets,
    format: (w) => (w.pellets > 1 ? `${w.damage} × ${w.pellets}` : w.burst > 1 ? `${w.damage} × ${w.burst} loạt` : String(w.damage)),
  },
  { label: 'Tốc độ bắn', value: (w) => w.fireRate * w.burst, format: (w) => `${(w.fireRate * w.burst).toFixed(1)}/s` },
  { label: 'Băng đạn', value: (w) => w.mag, format: (w) => String(w.mag) },
  { label: 'Nạp đạn', value: (w) => w.reload, format: (w) => `${w.reload.toFixed(1)}s`, lowerIsBetter: true },
  { label: 'Độ chính xác', value: (w) => 1 / (w.spread + 0.02), format: (w) => (w.spread <= 0.02 ? 'Rất cao' : w.spread <= 0.06 ? 'Cao' : w.spread <= 0.15 ? 'Vừa' : 'Thấp') },
  { label: 'Tầm bắn', value: (w) => w.range, format: (w) => String(Math.round(w.range)) },
  { label: 'Tốc chạy', value: (w) => w.moveMult, format: (w) => `${Math.round(w.moveMult * 100)}%` },
];

const SCALE = STATS.map((s) => {
  const all = WEAPON_ORDER.flatMap((id) => MODS[id].map((m) => s.value(buildWeapon(id, m.id))));
  return { min: Math.min(...all), max: Math.max(...all) };
});

function pct(i: number, w: WeaponDef): number {
  const s = STATS[i], { min, max } = SCALE[i];
  const v = s.value(w);
  const k = s.lowerIsBetter ? (max - v) / (max - min) : (v - min * 0.6) / (max - min * 0.6);
  return Math.max(5, Math.min(100, k * 100));
}

// ---------- DOM helpers ----------
function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
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
  onBuy: (id: WeaponId, modId: string) => void;
  onSelect: (id: WeaponId, modId: string) => void;
}

export class Armory {
  private selected: WeaponId = 'pistol';
  private preview: Partial<Record<WeaponId, string>> = {};
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
      const mp = p.mods[id];
      const tile = h('button', `wtile${id === this.selected ? ' selected' : ''}`);
      tile.type = 'button';
      tile.append(weaponIcon(id));
      const info = h('div', 'wtile-info');
      const mod = MODS[id].find((m) => m.id === mp.selected)!;
      info.append(h('div', 'wtile-name', buildWeapon(id).name), h('span', 'wtile-mod', mod.name));
      tile.append(info);
      const canBuy = MODS[id].some((m) => !mp.owned.includes(m.id) && !modBlocker(p, id, m));
      if (canBuy) tile.append(h('span', 'dot', ''));
      tile.addEventListener('click', () => { this.selected = id; this.render(); });
      return tile;
    }));
  }

  private renderDetail(p: Progress) {
    const id = this.selected;
    const mp = p.mods[id];
    const previewId = this.preview[id] ?? mp.selected;
    const equipped = buildWeapon(id, mp.selected);
    const shown = buildWeapon(id, previewId);
    const box = this.root.querySelector('#weapon-detail')!;
    box.replaceChildren();

    const head = h('div', 'wd-head');
    head.append(weaponIcon(id, 'gun big'));
    const title = h('div');
    title.append(h('div', 'wd-name', shown.name), h('p', 'wd-role', WEAPON_ROLE[id]));
    head.append(title);
    box.append(head);

    // Thanh chỉ số của chế độ đang xem, so với chế độ đang dùng
    const comparing = previewId !== mp.selected;
    box.append(h('div', 'wd-section', comparing ? `So sánh: ${equipped.modName} → ${shown.modName}` : `Chỉ số · ${shown.modName}`));
    const stats = h('div', 'wd-stats');
    STATS.forEach((s, i) => {
      const row = h('div', 'stat-row');
      const bar = h('div', 'stat-bar');
      const a = pct(i, equipped), b = pct(i, shown);
      const fill = h('i');
      fill.style.width = `${Math.min(a, b)}%`;
      bar.append(fill);
      if (b > a + 0.5) {
        const g = h('b', 'gain'); g.style.left = `${a}%`; g.style.width = `${b - a}%`; bar.append(g);
      } else if (a > b + 0.5) {
        const l = h('b', 'loss'); l.style.left = `${b}%`; l.style.width = `${a - b}%`; bar.append(l);
      }
      const fa = s.format(equipped), fb = s.format(shown);
      const cls = fa === fb ? '' : b > a ? ' up' : ' down';
      row.append(h('span', 'stat-label', s.label), bar, h('span', `stat-val${cls}`, fa === fb ? fb : `${fa} → ${fb}`));
      stats.append(row);
    });
    box.append(stats);

    const specials: string[] = [];
    if (shown.bounces) specials.push(`Đạn nảy ${shown.bounces} lần`);
    if (shown.pierce) specials.push(`Xuyên ${shown.pierce} tường`);
    if (shown.tracer === 'faint') specials.push('Vệt đạn mờ, tiếng nhỏ');
    if (specials.length) box.append(h('div', 'wd-special', `✦ ${specials.join(' · ')}`));

    // Các chế độ
    box.append(h('div', 'wd-section', 'Chế độ súng'));
    const grid = h('div', 'mod-grid');
    for (const mod of MODS[id]) {
      const owned = mp.owned.includes(mod.id);
      const active = mp.selected === mod.id;
      const card = h('div', `mod-card${active ? ' active' : ''}${mod.id === previewId ? ' previewing' : ''}${owned ? '' : ' locked'}`);
      card.tabIndex = 0;
      const top = h('div', 'mod-top');
      top.append(h('span', 'mod-name', mod.name), h('span', 'mod-tag', active ? 'Đang dùng' : owned ? 'Đã có' : `${mod.cost} xu`));
      card.append(top, h('div', 'mod-desc', mod.desc));
      if (mod.pros.length || mod.cons.length) {
        const pc = h('div', 'mod-pc');
        for (const x of mod.pros) pc.append(h('span', 'pro', `+ ${x}`));
        for (const x of mod.cons) pc.append(h('span', 'con', `− ${x}`));
        card.append(pc);
      }
      const previewThis = () => { this.preview[id] = mod.id; this.render(); };
      card.addEventListener('click', previewThis);
      card.addEventListener('keydown', (e) => { if (e.key === 'Enter') previewThis(); });

      const btn = h('button', 'mod-btn');
      btn.type = 'button';
      if (active) {
        btn.textContent = '✓ Đang dùng';
        btn.disabled = true;
      } else if (owned) {
        btn.textContent = 'Dùng chế độ này';
        btn.classList.add('primary');
        btn.addEventListener('click', (e) => { e.stopPropagation(); this.preview[id] = mod.id; this.hooks.onSelect(id, mod.id); });
      } else {
        const blocker = modBlocker(p, id, mod);
        btn.textContent = blocker ?? `Mở khóa · ${mod.cost} xu`;
        btn.disabled = !!blocker;
        if (!blocker) {
          btn.classList.add('primary');
          btn.addEventListener('click', (e) => { e.stopPropagation(); this.preview[id] = mod.id; this.hooks.onBuy(id, mod.id); });
        }
      }
      card.append(btn);
      grid.append(card);
    }
    box.append(grid);
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
