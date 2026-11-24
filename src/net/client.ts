import Peer, { type DataConnection } from 'peerjs';
import { ROUND_TIME, TEAM_COLORS } from '../game/constants';
import { MAPS, type GameMap } from '../game/map';
import { moveStep, Player, type Bullet, type GameEvent, type Mover, type Phase, type Pickup, type PlayerInput, type WorldView } from '../game/world';
import { loadoutFromMods } from '../progression';
import {
  PEER_OPTIONS, PEER_PREFIX, PHASES, PROTOCOL_VERSION, applyPlayerState, packInput, unpackBullet, unpackPickup,
  type ClientMsg, type HostMsg, type LobbyState, type Mods, type ResultInfo, type Snapshot, type StartInfo,
} from './protocol';
import type { Team } from '../game/constants';

/** Người vào phòng: kết nối tới chủ phòng, gửi input, nhận snapshot. */
export class NetClient {
  key = '';
  lobby: LobbyState | null = null;
  rtt: number | null = null;
  private pingTimer: number;

  onLobby: (l: LobbyState) => void = () => {};
  onStart: (s: StartInfo) => void = () => {};
  onSnapshot: (s: Snapshot) => void = () => {};
  onResult: (r: ResultInfo) => void = () => {};
  onClosed: (reason: string) => void = () => {};

  private constructor(private peer: Peer, private conn: DataConnection) {
    conn.on('data', (raw) => this.onMessage(raw as HostMsg));
    conn.on('close', () => this.closed('Mất kết nối với chủ phòng.'));
    conn.on('error', () => this.closed('Mất kết nối với chủ phòng.'));
    this.pingTimer = window.setInterval(() => this.send({ t: 'ping', ts: performance.now(), rtt: this.rtt }), 2000);
  }

  static join(code: string, name: string, mods: Mods): Promise<NetClient> {
    return new Promise((resolve, reject) => {
      const peer = new Peer(PEER_OPTIONS);
      let done = false;
      const fail = (msg: string) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        peer.destroy();
        reject(new Error(msg));
      };
      const timer = setTimeout(() => fail('Hết thời gian kết nối. Kiểm tra mã phòng hoặc mạng (một số mạng 4G/công ty chặn kết nối P2P).'), 15000);
      peer.on('error', (err) => {
        const type = (err as { type?: string }).type;
        fail(type === 'peer-unavailable' ? `Không tìm thấy phòng ${code}.` : `Lỗi kết nối: ${type ?? err}`);
      });
      peer.on('open', () => {
        const conn = peer.connect(PEER_PREFIX + code, { reliable: true, serialization: 'json' });
        conn.on('open', () => conn.send({ t: 'hello', v: PROTOCOL_VERSION, name, mods } satisfies ClientMsg));
        conn.on('data', (raw) => {
          if (done) return;
          const m = raw as HostMsg;
          if (m.t === 'reject') fail(m.reason);
          if (m.t === 'welcome') {
            done = true;
            clearTimeout(timer);
            const client = new NetClient(peer, conn);
            client.key = m.key;
            resolve(client);
          }
        });
      });
    });
  }

  private onMessage(m: HostMsg) {
    switch (m.t) {
      case 'lobby': this.lobby = m.lobby; this.onLobby(m.lobby); break;
      case 'start': this.onStart(m.start); break;
      case 'snap': this.onSnapshot(m.s); break;
      case 'result': this.onResult(m.r); break;
      case 'pong': {
        const sample = performance.now() - m.ts;
        this.rtt = this.rtt === null ? sample : this.rtt * 0.7 + sample * 0.3;
        break;
      }
      case 'reject': this.closed(m.reason); break;
      case 'closed': this.closed(m.reason); break;
    }
  }

  private closedOnce = false;
  private closed(reason: string) {
    if (this.closedOnce) return;
    this.closedOnce = true;
    clearInterval(this.pingTimer);
    this.onClosed(reason);
    setTimeout(() => this.peer.destroy(), 300);
  }

  send(m: ClientMsg) {
    if (this.conn.open) this.conn.send(m);
  }

  sendInput(seq: number, inp: PlayerInput) { this.send({ t: 'input', s: seq, i: packInput(inp) }); }
  requestTeam(team: Team) { this.send({ t: 'team', team }); }

  leave() {
    this.closedOnce = true;
    clearInterval(this.pingTimer);
    this.conn.close();
    setTimeout(() => this.peer.destroy(), 300);
  }
}

// ---------- Thế giới phía người vào phòng ----------
const INTERP_TICKS = 6; // vẽ người khác trễ 100ms để nội suy mượt

/**
 * Hiển thị trận đấu từ snapshot của chủ phòng:
 * - Người khác + đạn: nội suy giữa 2 snapshot → mượt dù chỉ nhận 30 lần/giây.
 * - Bản thân: tự dự đoán di chuyển ngay khi bấm phím, khi có snapshot thì đối chiếu & chạy lại các input chưa được xác nhận.
 */
export class ClientWorld implements WorldView {
  readonly map: GameMap;
  readonly players: Player[];
  readonly myId: number;
  bullets: Bullet[] = [];
  pickups: Pickup[] = [];
  phase: Phase = 'countdown';
  round = 1;
  roundTime = ROUND_TIME;
  score: [number, number] = [0, 0];
  elapsed = 0;
  roundId = -1;

  private snaps: Snapshot[] = [];
  private offset: number | null = null; // tick chủ phòng − tick đồng hồ máy mình
  private seq = 0;
  private pending: { s: number; i: PlayerInput; moved: boolean }[] = [];
  private pred: Mover;
  private errX = 0;
  private errY = 0;
  private events: GameEvent[] = [];

  constructor(start: StartInfo) {
    this.map = MAPS.find((m) => m.id === start.mapId) ?? MAPS[0];
    const perTeam = [0, 0];
    this.players = start.roster.map((r, i) =>
      new Player(i, r.name, r.team, TEAM_COLORS[r.team][perTeam[r.team]++ % 3], loadoutFromMods(r.mods)));
    this.myId = start.you;
    this.pred = { x: 0, y: 0, vx: 0, vy: 0, aim: 0, dashT: 0, dashCd: 0, dashDx: 0, dashDy: 0, speedBoostT: 0 };
  }

  get me(): Player { return this.players[this.myId]; }

  private localTick(now: number) { return now * 0.06; }

  /** Gọi mỗi tick (60/s) với input của mình → trả về số thứ tự để gửi đi. */
  applyLocalInput(inp: PlayerInput): number {
    const s = ++this.seq;
    const me = this.me;
    const moved = this.phase === 'playing' && me.alive;
    if (moved) moveStep(this.pred, inp, this.map.walls, me.def.moveMult);
    this.pred.aim = inp.aim;
    this.pending.push({ s, i: inp, moved });
    if (this.pending.length > 180) this.pending.shift();
    return s;
  }

  onSnapshot(snap: Snapshot) {
    const last = this.snaps[this.snaps.length - 1];
    if (last && snap.k <= last.k) return; // gói cũ đến muộn
    this.snaps.push(snap);
    if (this.snaps.length > 40) this.snaps.shift();

    // Đồng bộ đồng hồ: tăng nhanh, giảm chậm để chống giật
    const sample = snap.k - this.localTick(performance.now());
    if (this.offset === null || Math.abs(sample - this.offset) > 30) this.offset = sample;
    else this.offset += (sample - this.offset) * (sample > this.offset ? 0.2 : 0.02);

    this.phase = PHASES[snap.ph] ?? 'playing';
    this.roundTime = snap.rt;
    this.round = snap.r;
    this.score = snap.sc;
    this.pickups = snap.pk.map(unpackPickup);
    this.events.push(...snap.ev);
    snap.p.forEach((a, i) => { if (this.players[i]) applyPlayerState(this.players[i], a); });

    // Đối chiếu vị trí của mình
    const sv = snap.p[this.myId];
    if (!sv) return;
    const shownX = this.pred.x + this.errX, shownY = this.pred.y + this.errY;
    const newRound = snap.rid !== this.roundId;
    this.roundId = snap.rid;
    Object.assign(this.pred, { x: sv[0], y: sv[1], dashT: sv[9], dashCd: sv[10], dashDx: sv[11], dashDy: sv[12], speedBoostT: sv[14] });
    this.pending = this.pending.filter((p) => p.s > snap.ack);
    if (newRound) {
      this.pending = [];
      this.pred.aim = sv[2];
    }
    for (const p of this.pending) if (p.moved) moveStep(this.pred, p.i, this.map.walls, this.me.def.moveMult);
    this.errX = shownX - this.pred.x;
    this.errY = shownY - this.pred.y;
    if (newRound || Math.hypot(this.errX, this.errY) > 120) { this.errX = 0; this.errY = 0; }
  }

  /** Cập nhật vị trí hiển thị cho khung hình hiện tại. */
  updateView(dt: number) {
    this.elapsed += dt;
    const decay = Math.exp(-dt / 0.08);
    this.errX *= decay; this.errY *= decay;
    if (!this.snaps.length || this.offset === null) return;

    const renderTick = this.localTick(performance.now()) + this.offset - INTERP_TICKS;
    let a = this.snaps[0], b = this.snaps[this.snaps.length - 1];
    for (let i = this.snaps.length - 1; i > 0; i--) {
      if (this.snaps[i - 1].k <= renderTick) { a = this.snaps[i - 1]; b = this.snaps[i]; break; }
    }
    const t = b.k === a.k ? 1 : Math.max(0, Math.min(1, (renderTick - a.k) / (b.k - a.k)));

    this.players.forEach((p, i) => {
      if (i === this.myId) return;
      const pa = a.p[i], pb = b.p[i];
      if (!pa || !pb) return;
      // Không nội suy khi bị dịch chuyển (sang round mới)
      const jump = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) > 200;
      p.x = jump ? pb[0] : pa[0] + (pb[0] - pa[0]) * t;
      p.y = jump ? pb[1] : pa[1] + (pb[1] - pa[1]) * t;
      let da = pb[2] - pa[2];
      if (da > Math.PI) da -= Math.PI * 2;
      if (da < -Math.PI) da += Math.PI * 2;
      p.aim = pa[2] + da * t;
    });

    const me = this.me;
    me.x = this.pred.x + this.errX;
    me.y = this.pred.y + this.errY;
    me.aim = this.pred.aim;

    const prev = new Map(a.b.map((x) => [x[0], x]));
    this.bullets = b.b.map((x) => {
      const bl = unpackBullet(x);
      const o = prev.get(x[0]);
      if (o) { bl.x = o[1] + (x[1] - o[1]) * t; bl.y = o[2] + (x[2] - o[2]) * t; }
      return bl;
    });
  }

  drainEvents(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}
