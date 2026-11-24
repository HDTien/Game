import { W, H, PLAYER_R, MAX_HP, DASH_CD, TEAM_NAMES, TEAM_COLORS } from './game/constants';
import { PICKUPS, PICKUP_R, MAX_ARMOR, BOOST_TIME } from './game/pickups';
import { BASE_WEAPONS } from './game/weapons';
import type { GameEvent, Player, WorldView } from './game/world';

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number }
interface Floater { x: number; y: number; text: string; life: number; color: string }
interface Banner { text: string; sub: string; t: number; max: number; color: string }
interface KillFeed { killer: string; killerColor: string; victim: string; victimColor: string; weapon: string; t: number }

export interface DrawOptions {
  crosshair: { x: number; y: number } | null;
  /** Người chơi điều khiển trên máy này (hiện bảng thông tin lớn ở dưới). */
  focus: number[];
  /** Đánh dấu "bạn" trên bản đồ (online / đấu bot). */
  me: number | null;
}

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const BULLET_COLORS = ['#bdf0ff', '#ffc2dd'];

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private particles: Particle[] = [];
  private floaters: Floater[] = [];
  private feed: KillFeed[] = [];
  private shake = 0;
  private banner: Banner | null = null;
  private time = 0;
  screenShake = true;

  constructor(canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  reset() {
    this.particles = [];
    this.floaters = [];
    this.feed = [];
    this.shake = 0;
    this.banner = null;
  }

  private burst(x: number, y: number, n: number, color: string, speed: number, angle?: number, spread = Math.PI * 2, size = 3) {
    for (let i = 0; i < n; i++) {
      const a = angle === undefined ? Math.random() * Math.PI * 2 : angle + (Math.random() - 0.5) * spread;
      const s = speed * (0.4 + Math.random() * 0.6);
      const life = 0.2 + Math.random() * 0.3;
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, color, size });
    }
  }

  private show(text: string, sub = '', color = '#fff', dur = 1) {
    this.banner = { text, sub, t: dur, max: dur, color };
  }

  /** Tên hiển thị của đội/người thắng: 1vs1 dùng tên người, còn lại dùng tên đội. */
  private winnerLabel(view: WorldView, team: 0 | 1): { text: string; color: string } {
    const members = view.players.filter((p) => p.team === team);
    if (members.length === 1) return { text: members[0].name, color: members[0].color };
    return { text: TEAM_NAMES[team], color: TEAM_COLORS[team][0] };
  }

  onEvents(events: GameEvent[], view: WorldView) {
    for (const e of events) {
      switch (e.type) {
        case 'shoot': {
          if (e.mod === 'silencer') { this.burst(e.x, e.y, 1, '#888', 80, e.angle, 0.4, 2); break; }
          const big = e.weapon === 'shotgun' || e.weapon === 'sniper';
          this.burst(e.x, e.y, big ? 10 : 4, '#ffd166', 260, e.angle, 0.6, 2.5);
          if (big && view.players[e.owner]) this.shake = Math.max(this.shake, 4);
          break;
        }
        case 'hit':
          this.burst(e.x, e.y, 7, e.armor ? '#4895ef' : '#ff4d6d', 220, e.angle, 1.2);
          this.floaters.push({ x: e.x, y: e.y - 10, text: String(e.damage), life: 0.7, color: e.armor ? '#b8d4ff' : '#ffe1e8' });
          this.shake = Math.max(this.shake, 3);
          break;
        case 'kill': {
          const k = view.players[e.killer], v = view.players[e.victim];
          if (!k || !v) break;
          this.burst(e.x, e.y, 30, v.color, 380, undefined, undefined, 4);
          this.shake = Math.max(this.shake, 10);
          this.feed.unshift({ killer: k.name, killerColor: k.color, victim: v.name, victimColor: v.color, weapon: BASE_WEAPONS[e.weapon].name, t: 5 });
          this.feed.length = Math.min(this.feed.length, 5);
          break;
        }
        case 'spark':
          this.burst(e.x, e.y, 4, '#aab4c8', 160);
          break;
        case 'dash':
          if (view.players[e.owner]) this.burst(e.x, e.y, 10, view.players[e.owner].color, 120);
          break;
        case 'pickupSpawn':
          this.burst(e.x, e.y, 12, PICKUPS[e.kind].color, 140);
          break;
        case 'pickup': {
          const info = PICKUPS[e.kind];
          this.burst(e.x, e.y, 16, info.color, 200);
          this.floaters.push({ x: e.x, y: e.y - 20, text: info.label, life: 1.1, color: info.color });
          break;
        }
        case 'countdown':
          this.show(String(e.n), `Round ${view.round}`, '#fff', 0.9);
          break;
        case 'go':
          this.show('BẮN!', '', '#ffd166', 0.7);
          break;
        case 'roundEnd': {
          const sub = e.reason === 'time' ? 'Hết giờ' : '';
          if (e.winner === null) this.show('Hòa round', sub, '#ddd', 2.3);
          else { const w = this.winnerLabel(view, e.winner); this.show(`${w.text} thắng round`, sub, w.color, 2.3); }
          break;
        }
        case 'matchEnd':
          if (e.winner === null) this.show('HÒA', '', '#ddd', 3);
          else { const w = this.winnerLabel(view, e.winner); this.show(`${w.text} THẮNG!`, '', w.color, 3); }
          break;
      }
    }
  }

  update(dt: number) {
    this.time += dt;
    for (const p of this.particles) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.9; p.vy *= 0.9;
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const f of this.floaters) { f.y -= 40 * dt; f.life -= dt; }
    this.floaters = this.floaters.filter((f) => f.life > 0);
    for (const k of this.feed) k.t -= dt;
    this.feed = this.feed.filter((k) => k.t > 0);
    this.shake = Math.max(0, this.shake - 40 * dt);
    if (this.banner) { this.banner.t -= dt; if (this.banner.t <= 0) this.banner = null; }
  }

  draw(view: WorldView, opt: DrawOptions) {
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#151922';
    c.fillRect(0, 0, W, H);

    c.save();
    if (this.screenShake && this.shake > 0) {
      c.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
    }
    this.drawFloor();
    this.drawWalls(view);
    this.drawPickups(view);
    this.drawBullets(view);
    for (const p of view.players) if (!p.alive) this.drawPlayer(p, view, opt.me);
    for (const p of view.players) if (p.alive) this.drawPlayer(p, view, opt.me);
    this.drawParticles();
    c.restore();

    this.drawHud(view, opt);
    this.drawBanner();
    if (opt.crosshair) this.drawCrosshair(opt.crosshair.x, opt.crosshair.y);
  }

  private drawFloor() {
    const c = this.ctx;
    c.strokeStyle = '#1b2030';
    c.lineWidth = 1;
    c.beginPath();
    for (let x = 0; x <= W; x += 40) { c.moveTo(x + 0.5, 0); c.lineTo(x + 0.5, H); }
    for (let y = 0; y <= H; y += 40) { c.moveTo(0, y + 0.5); c.lineTo(W, y + 0.5); }
    c.stroke();
  }

  private drawWalls(view: WorldView) {
    const c = this.ctx;
    for (const w of view.map.walls) {
      c.fillStyle = '#2a3142';
      c.fillRect(w.x, w.y, w.w, w.h);
      c.fillStyle = '#353e54';
      c.fillRect(w.x, w.y, w.w, Math.min(4, w.h));
      c.strokeStyle = '#0d1017';
      c.lineWidth = 2;
      c.strokeRect(w.x + 1, w.y + 1, w.w - 2, w.h - 2);
    }
  }

  private drawPickups(view: WorldView) {
    const c = this.ctx;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (const k of view.pickups) {
      const info = PICKUPS[k.kind];
      const pop = Math.min(1, k.age / 0.25);
      const r = PICKUP_R * pop * (1 + Math.sin(k.age * 5) * 0.08);
      c.globalAlpha = 0.25;
      c.fillStyle = info.color;
      c.beginPath(); c.arc(k.x, k.y, r + 7, 0, Math.PI * 2); c.fill();
      c.globalAlpha = 1;
      c.beginPath(); c.arc(k.x, k.y, r, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#10131a';
      c.font = `900 ${Math.max(1, Math.round(15 * pop))}px ${FONT}`;
      c.fillText(info.symbol, k.x, k.y + 1);
    }
    c.textBaseline = 'alphabetic';
  }

  private drawBullets(view: WorldView) {
    const c = this.ctx;
    c.lineCap = 'round';
    for (const b of view.bullets) {
      c.strokeStyle = BULLET_COLORS[b.team];
      c.globalAlpha = b.tracer === 'faint' ? 0.22 : 1;
      c.lineWidth = b.tracer === 'heavy' ? 4.5 : b.tracer === 'faint' ? 1.5 : 3;
      const len = b.tracer === 'heavy' ? 0.03 : 0.018;
      c.beginPath();
      c.moveTo(b.x - b.vx * len, b.y - b.vy * len);
      c.lineTo(b.x, b.y);
      c.stroke();
    }
    c.globalAlpha = 1;
  }

  private drawPlayer(p: Player, view: WorldView, me: number | null) {
    const c = this.ctx;
    c.save();
    c.globalAlpha = p.alive ? 1 : 0.25;

    // Bóng
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.beginPath(); c.ellipse(p.x + 3, p.y + 5, PLAYER_R, PLAYER_R * 0.8, 0, 0, Math.PI * 2); c.fill();

    // Súng
    c.save();
    c.translate(p.x, p.y);
    c.rotate(p.aim);
    c.fillStyle = '#c9d1e0';
    const len = p.def.gunLength, thick = p.def.id === 'shotgun' ? 8 : 6;
    c.fillRect(PLAYER_R - 6, -thick / 2, len, thick);
    if (p.def.modId === 'akimbo') c.fillRect(PLAYER_R - 8, -thick / 2 - 8, len - 4, thick - 1);
    c.restore();

    // Hào quang buff
    if (p.alive && (p.damageBoostT > 0 || p.speedBoostT > 0)) {
      const col = p.damageBoostT > 0 ? PICKUPS.damage.color : PICKUPS.speed.color;
      c.strokeStyle = col;
      c.lineWidth = 2;
      c.globalAlpha = 0.5 + Math.sin(this.time * 12) * 0.3;
      c.beginPath(); c.arc(p.x, p.y, PLAYER_R + 4, 0, Math.PI * 2); c.stroke();
      c.globalAlpha = 1;
    }

    // Thân
    c.fillStyle = p.hitFlash > 0 ? '#ffffff' : p.color;
    c.beginPath(); c.arc(p.x, p.y, PLAYER_R, 0, Math.PI * 2); c.fill();
    c.strokeStyle = p.id === me ? '#ffffff' : 'rgba(0,0,0,0.5)';
    c.lineWidth = p.id === me ? 2.5 : 2;
    c.stroke();

    if (!p.alive) {
      c.strokeStyle = '#fff'; c.lineWidth = 3;
      c.beginPath();
      c.moveTo(p.x - 7, p.y - 7); c.lineTo(p.x + 7, p.y + 7);
      c.moveTo(p.x + 7, p.y - 7); c.lineTo(p.x - 7, p.y + 7);
      c.stroke();
    }

    // Vòng nạp đạn
    if (p.alive && p.reloading) {
      const k = Math.max(0, Math.min(1, 1 - p.reloadT / p.def.reload));
      c.strokeStyle = '#ffd166'; c.lineWidth = 3;
      c.beginPath(); c.arc(p.x, p.y, PLAYER_R + 6, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2); c.stroke();
    }

    // Tên + thanh máu nhỏ
    if (p.alive && view.phase !== 'matchEnd') {
      c.font = `600 12px ${FONT}`;
      c.textAlign = 'center';
      c.fillStyle = p.id === me ? '#ffffff' : 'rgba(255,255,255,0.8)';
      c.fillText(p.id === me ? `▼ ${p.name}` : p.name, p.x, p.y - PLAYER_R - 16);
      c.fillStyle = 'rgba(0,0,0,0.6)';
      c.fillRect(p.x - 20, p.y - PLAYER_R - 11, 40, 5);
      c.fillStyle = p.hp > 30 ? '#06d6a0' : '#ef476f';
      c.fillRect(p.x - 20, p.y - PLAYER_R - 11, (40 * p.hp) / MAX_HP, 5);
      if (p.armor > 0) {
        c.fillStyle = PICKUPS.armor.color;
        c.fillRect(p.x - 20, p.y - PLAYER_R - 6, (40 * p.armor) / MAX_ARMOR, 2);
      }
      // Vạch nhỏ dưới chân để phân biệt đội
      c.fillStyle = TEAM_COLORS[p.team][0];
      c.fillRect(p.x - 8, p.y + PLAYER_R + 4, 16, 2);
    }
    c.restore();
  }

  private drawParticles() {
    const c = this.ctx;
    for (const p of this.particles) {
      c.globalAlpha = Math.max(0, p.life / p.max);
      c.fillStyle = p.color;
      c.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    c.globalAlpha = 1;
    c.textAlign = 'center';
    c.font = `700 16px ${FONT}`;
    for (const f of this.floaters) {
      c.globalAlpha = Math.min(1, f.life / 0.4);
      c.fillStyle = f.color;
      c.fillText(f.text, f.x, f.y);
    }
    c.globalAlpha = 1;
  }

  // ---------- HUD ----------
  private drawHud(view: WorldView, opt: DrawOptions) {
    const c = this.ctx;
    const t0 = view.players.filter((p) => p.team === 0), t1 = view.players.filter((p) => p.team === 1);
    const solo = t0.length === 1 && t1.length === 1;

    // Bảng điểm trên cùng
    c.fillStyle = 'rgba(10,12,18,0.78)';
    c.beginPath(); c.roundRect(W / 2 - 210, 26, 420, 62, 10); c.fill();
    c.textBaseline = 'middle';
    c.font = `800 30px ${FONT}`;
    c.textAlign = 'center';
    c.fillStyle = TEAM_COLORS[0][0]; c.fillText(String(view.score[0]), W / 2 - 34, 50);
    c.fillStyle = '#6b7385'; c.fillText(':', W / 2, 48);
    c.fillStyle = TEAM_COLORS[1][0]; c.fillText(String(view.score[1]), W / 2 + 34, 50);
    c.font = `600 14px ${FONT}`;
    const left = solo ? t0[0].name : `${TEAM_NAMES[0]} ${t0.length}`;
    const right = solo ? t1[0].name : `${t1.length} ${TEAM_NAMES[1]}`;
    c.textAlign = 'right'; c.fillStyle = TEAM_COLORS[0][0]; c.fillText(truncate(left, 16), W / 2 - 64, 50);
    c.textAlign = 'left'; c.fillStyle = TEAM_COLORS[1][0]; c.fillText(truncate(right, 16), W / 2 + 64, 50);
    const t = Math.ceil(view.roundTime);
    c.textAlign = 'center';
    c.font = `500 12px ${FONT}`;
    c.fillStyle = t <= 10 && view.phase === 'playing' ? '#ef476f' : '#9aa3b5';
    c.fillText(`Round ${view.round}  ·  ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`, W / 2, 77);

    // Danh sách đội (chế độ nhiều người)
    if (!solo) {
      this.roster(t0, 28, 'left', opt.me);
      this.roster(t1, W - 28, 'right', opt.me);
    }
    this.drawFeed(solo ? 104 : 30 + 22 * Math.max(t0.length, t1.length) + 12, opt.focus.length > 1);

    // Bảng thông tin lớn: 1 người → góc trái; 2 người cùng máy → hai góc
    const focus = opt.focus.map((id) => view.players[id]).filter(Boolean);
    if (focus[0]) this.playerPanel(focus[0], 36, H - 96);
    if (focus[1]) this.playerPanel(focus[1], W - 36 - 264, H - 96);
    c.textBaseline = 'alphabetic';
  }

  private roster(list: Player[], x: number, align: 'left' | 'right', me: number | null) {
    const c = this.ctx;
    const w = 168;
    const bx = align === 'left' ? x : x - w;
    list.forEach((p, i) => {
      const y = 30 + i * 22;
      c.globalAlpha = p.alive ? 1 : 0.45;
      c.fillStyle = 'rgba(10,12,18,0.7)';
      c.beginPath(); c.roundRect(bx, y, w, 19, 5); c.fill();
      c.fillStyle = p.color;
      c.beginPath(); c.arc(bx + 10, y + 9.5, 4, 0, Math.PI * 2); c.fill();
      c.font = `${p.id === me ? 800 : 600} 11px ${FONT}`;
      c.textAlign = 'left';
      c.fillStyle = '#e6e9ef';
      c.fillText(truncate(p.name, 11), bx + 19, y + 10);
      c.fillStyle = '#2a3142'; c.fillRect(bx + 104, y + 7, 56, 5);
      if (p.alive) { c.fillStyle = p.hp > 30 ? '#06d6a0' : '#ef476f'; c.fillRect(bx + 104, y + 7, (56 * p.hp) / MAX_HP, 5); }
    });
    c.globalAlpha = 1;
  }

  private drawFeed(top: number, twoPanels: boolean) {
    const c = this.ctx;
    c.font = `600 12px ${FONT}`;
    c.textBaseline = 'middle';
    this.feed.slice(0, twoPanels ? 3 : 5).forEach((k, i) => {
      const y = top + i * 22;
      const text = [k.killer, ` ✕ `, k.victim, `  ${k.weapon}`];
      const widths = text.map((s) => c.measureText(s).width);
      const total = widths.reduce((a, b) => a + b, 0) + 16;
      let x = W - 28 - total;
      c.globalAlpha = Math.min(1, k.t / 0.5);
      c.fillStyle = 'rgba(10,12,18,0.72)';
      c.beginPath(); c.roundRect(x, y - 9, total, 19, 5); c.fill();
      x += 8;
      const colors = [k.killerColor, '#9aa3b5', k.victimColor, '#6b7385'];
      c.textAlign = 'left';
      text.forEach((s, j) => { c.fillStyle = colors[j]; c.fillText(s, x, y + 1); x += widths[j]; });
    });
    c.globalAlpha = 1;
  }

  private playerPanel(p: Player, x: number, y: number) {
    const c = this.ctx;
    c.fillStyle = 'rgba(10,12,18,0.72)';
    c.beginPath(); c.roundRect(x, y, 264, 70, 10); c.fill();
    c.textBaseline = 'alphabetic';

    c.font = `700 13px ${FONT}`;
    c.textAlign = 'left'; c.fillStyle = p.color; c.fillText(truncate(p.name, 18), x + 12, y + 15);
    c.textAlign = 'right'; c.fillStyle = '#fff';
    c.fillText(p.alive ? `${Math.ceil(p.hp)} HP${p.armor > 0 ? ` · ${Math.ceil(p.armor)} giáp` : ''}` : 'Đã bị hạ', x + 252, y + 15);

    // Máu + giáp
    c.fillStyle = '#2a3142'; c.fillRect(x + 12, y + 26, 240, 10);
    c.fillStyle = p.hp > 30 ? '#06d6a0' : '#ef476f'; c.fillRect(x + 12, y + 26, (240 * p.hp) / MAX_HP, 10);
    if (p.armor > 0) { c.fillStyle = PICKUPS.armor.color; c.fillRect(x + 12, y + 32, (240 * p.armor) / MAX_ARMOR, 4); }

    // Buff đang có (hiện phía trên bảng)
    const buffs: [string, number, string][] = [];
    if (p.damageBoostT > 0) buffs.push(['Sát thương x1.3', p.damageBoostT, PICKUPS.damage.color]);
    if (p.speedBoostT > 0) buffs.push(['Tốc độ', p.speedBoostT, PICKUPS.speed.color]);
    buffs.forEach(([label, t, col], i) => {
      const bx = x + i * 132, by = y - 24;
      c.fillStyle = 'rgba(10,12,18,0.72)';
      c.beginPath(); c.roundRect(bx, by, 126, 18, 6); c.fill();
      c.fillStyle = col; c.fillRect(bx + 4, by + 14, 118 * (t / BOOST_TIME), 2);
      c.font = `700 11px ${FONT}`; c.textAlign = 'left';
      c.fillText(`${label} ${t.toFixed(1)}s`, bx + 6, by + 10);
    });
    // Lướt
    const ready = 1 - p.dashCd / DASH_CD;
    c.fillStyle = '#2a3142'; c.fillRect(x + 12, y + 39, 240, 3);
    c.fillStyle = ready >= 1 ? '#ffd166' : '#7a6a3a'; c.fillRect(x + 12, y + 39, 240 * ready, 3);

    // Súng + đạn: các ô số súng, ô đang cầm sáng lên
    p.weapons.forEach((_, i) => {
      c.fillStyle = i === p.weapon ? '#ffffff' : '#3a4256';
      c.fillRect(x + 12 + i * 9, y + 50, 6, 6);
    });
    const def = p.def;
    const nx = x + 12 + p.weapons.length * 9 + 6;
    c.textAlign = 'left';
    c.fillStyle = '#fff';
    c.font = `700 13px ${FONT}`;
    c.fillText(def.name, nx, y + 58);
    if (def.modId !== 'standard') {
      const nameW = c.measureText(def.name).width;
      c.fillStyle = '#ffd166';
      c.font = `600 11px ${FONT}`;
      c.fillText(truncate(def.modName, 12), nx + nameW + 6, y + 57);
    }
    c.textAlign = 'right';
    c.font = `700 13px ${FONT}`;
    c.fillStyle = p.reloading ? '#ffd166' : p.ammo[p.weapon] === 0 ? '#ef476f' : '#fff';
    c.fillText(p.reloading ? 'Đang nạp…' : `${p.ammo[p.weapon]} / ${p.def.mag}`, x + 252, y + 58);
  }

  private drawBanner() {
    const b = this.banner;
    if (!b) return;
    const c = this.ctx;
    const alpha = Math.min(1, b.t / 0.25, (b.max - b.t) / 0.08);
    c.save();
    c.globalAlpha = Math.max(0, alpha);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `900 64px ${FONT}`;
    c.lineWidth = 8;
    c.strokeStyle = 'rgba(0,0,0,0.6)';
    c.strokeText(b.text, W / 2, H / 2 - 20);
    c.fillStyle = b.color;
    c.fillText(b.text, W / 2, H / 2 - 20);
    if (b.sub) {
      c.font = `600 20px ${FONT}`;
      c.fillStyle = '#c9d1e0';
      c.fillText(b.sub, W / 2, H / 2 + 30);
    }
    c.restore();
  }

  private drawCrosshair(x: number, y: number) {
    const c = this.ctx;
    c.strokeStyle = '#ffffff';
    c.lineWidth = 2;
    c.beginPath();
    c.arc(x, y, 9, 0, Math.PI * 2);
    c.moveTo(x - 15, y); c.lineTo(x - 5, y);
    c.moveTo(x + 5, y); c.lineTo(x + 15, y);
    c.moveTo(x, y - 15); c.lineTo(x, y - 5);
    c.moveTo(x, y + 5); c.lineTo(x, y + 15);
    c.stroke();
  }
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
