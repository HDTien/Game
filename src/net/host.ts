import Peer, { type DataConnection } from 'peerjs';
import type { Team } from '../game/constants';
import type { Difficulty } from '../game/bot';
import { NO_INPUT, type GameEvent, type PlayerInput, type World } from '../game/world';
import {
  MAX_NAME, PEER_OPTIONS, PEER_PREFIX, PROTOCOL_VERSION, makeRoomCode, makeSnapshot, unpackInput,
  type ClientMsg, type HostMsg, type LobbyState, type Mods, type ResultInfo, type RosterInfo, type TeamSize,
} from './protocol';

interface Member {
  key: string;
  name: string;
  team: Team;
  bot: boolean;
  host: boolean;
  ping: number | null;
  conn: DataConnection | null;
  mods: Mods;
}

interface InputQueue { q: { s: number; i: PlayerInput }[]; last: PlayerInput; ack: number; lastRecv: number }

/** Chủ phòng: quản lý sảnh chờ, nhận input, phát snapshot. World được chạy ở main.ts. */
export class NetHost {
  readonly code: string;
  private members: Member[] = [];
  private botSeq = 0;
  teamSize: TeamSize = 1;
  mapId: string;
  botDifficulty: Difficulty = 'normal';
  fillBots = true;
  inGame = false;

  private idByKey = new Map<string, number>();
  private queues = new Map<number, InputQueue>();

  /** Lobby thay đổi (để vẽ lại giao diện). */
  onChange: () => void = () => {};
  /** Một người rời khi đang đấu → main.ts thay bằng bot. */
  onPlayerLeft: (playerId: number) => void = () => {};
  /** Mất kết nối tới máy chủ trung gian (không ảnh hưởng người đã vào). */
  onError: (msg: string) => void = () => {};

  private constructor(private peer: Peer, code: string, hostName: string, hostMods: Mods, mapId: string) {
    this.code = code;
    this.mapId = mapId;
    this.members.push({ key: 'host', name: hostName, team: 0, bot: false, host: true, ping: null, conn: null, mods: hostMods });
    peer.on('connection', (conn) => this.onConnection(conn));
    peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
    peer.on('error', (err) => this.onError(String((err as { type?: string }).type ?? err)));
  }

  static async create(name: string, mods: Mods, mapId: string): Promise<NetHost> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = makeRoomCode();
      const peer = new Peer(PEER_PREFIX + code, PEER_OPTIONS);
      const result = await new Promise<'ok' | 'taken' | string>((resolve) => {
        const timer = setTimeout(() => resolve('Không kết nối được máy chủ trung gian (hết thời gian).'), 12000);
        peer.once('open', () => { clearTimeout(timer); resolve('ok'); });
        peer.once('error', (err) => {
          clearTimeout(timer);
          const type = (err as { type?: string }).type;
          resolve(type === 'unavailable-id' ? 'taken' : `Lỗi kết nối: ${type ?? err}`);
        });
      });
      if (result === 'ok') return new NetHost(peer, code, name, mods, mapId);
      peer.destroy();
      if (result !== 'taken') throw new Error(result);
    }
    throw new Error('Không tạo được mã phòng, thử lại.');
  }

  // ---------- Kết nối ----------
  private onConnection(conn: DataConnection) {
    conn.on('data', (raw) => this.onMessage(conn, raw as ClientMsg));
    conn.on('close', () => this.onClose(conn));
    conn.on('error', () => this.onClose(conn));
  }

  private send(conn: DataConnection | null, m: HostMsg) {
    if (conn && conn.open) conn.send(m);
  }

  private onMessage(conn: DataConnection, m: ClientMsg) {
    if (!m || typeof m !== 'object') return;
    const member = this.members.find((x) => x.conn === conn);
    switch (m.t) {
      case 'hello': {
        if (member) return;
        if (m.v !== PROTOCOL_VERSION) return this.reject(conn, 'Phiên bản game khác nhau — hãy tải lại trang (Ctrl+F5).');
        if (this.inGame) return this.reject(conn, 'Phòng đang trong trận, hãy chờ trận kết thúc.');
        const team = this.freeTeam();
        if (team === null) {
          // Đầy: thay chỗ một bot nếu có
          const bot = this.members.find((x) => x.bot);
          if (!bot) return this.reject(conn, 'Phòng đã đầy.');
          this.members = this.members.filter((x) => x !== bot);
        }
        const name = String(m.name ?? '').trim().slice(0, MAX_NAME) || 'Người chơi';
        this.members.push({
          key: conn.peer, name: this.uniqueName(name), team: this.freeTeam() ?? 0, bot: false, host: false, ping: null,
          conn, mods: typeof m.mods === 'object' && m.mods ? m.mods : {},
        });
        this.send(conn, { t: 'welcome', key: conn.peer });
        this.changed();
        break;
      }
      case 'team': {
        if (!member || this.inGame || (m.team !== 0 && m.team !== 1) || member.team === m.team) return;
        if (this.count(m.team) >= this.teamSize) return;
        member.team = m.team;
        this.changed();
        break;
      }
      case 'input': {
        if (!member || !this.inGame) return;
        const id = this.idByKey.get(member.key);
        const q = id === undefined ? undefined : this.queues.get(id);
        if (!q || !Array.isArray(m.i) || typeof m.s !== 'number') return;
        q.q.push({ s: m.s, i: unpackInput(m.i) });
        q.lastRecv = performance.now();
        break;
      }
      case 'ping': {
        if (!member) return;
        this.send(conn, { t: 'pong', ts: m.ts });
        if (typeof m.rtt === 'number') {
          const changed = member.ping === null || Math.abs(member.ping - m.rtt) > 15;
          member.ping = Math.round(m.rtt);
          if (changed && !this.inGame) this.changed();
        }
        break;
      }
    }
  }

  private reject(conn: DataConnection, reason: string) {
    this.send(conn, { t: 'reject', reason });
    setTimeout(() => conn.close(), 500);
  }

  private onClose(conn: DataConnection) {
    const member = this.members.find((x) => x.conn === conn);
    if (!member) return;
    if (this.inGame) {
      const id = this.idByKey.get(member.key);
      member.conn = null;
      member.bot = true;
      member.name = `${member.name} (bot)`;
      if (id !== undefined) this.onPlayerLeft(id);
    } else {
      this.members = this.members.filter((x) => x !== member);
    }
    this.changed();
  }

  // ---------- Sảnh chờ ----------
  get lobby(): LobbyState {
    return {
      code: this.code,
      teamSize: this.teamSize,
      mapId: this.mapId,
      botDifficulty: this.botDifficulty,
      fillBots: this.fillBots,
      inGame: this.inGame,
      slots: this.members.map(({ key, name, team, bot, host, ping }) => ({ key, name, team, bot, host, ping })),
    };
  }

  private changed() {
    const lobby = this.lobby;
    for (const m of this.members) this.send(m.conn, { t: 'lobby', lobby });
    this.onChange();
  }

  private count(team: Team) { return this.members.filter((m) => m.team === team).length; }

  private freeTeam(): Team | null {
    const a = this.count(0), b = this.count(1);
    if (a >= this.teamSize && b >= this.teamSize) return null;
    if (a >= this.teamSize) return 1;
    if (b >= this.teamSize) return 0;
    return a <= b ? 0 : 1;
  }

  private uniqueName(name: string): string {
    let n = name, i = 2;
    while (this.members.some((m) => m.name === n)) n = `${name} ${i++}`;
    return n;
  }

  setTeamSize(size: TeamSize): string | null {
    // Bớt bot trước nếu đội đang dư người
    for (const team of [0, 1] as Team[]) {
      while (this.count(team) > size) {
        const bot = [...this.members].reverse().find((m) => m.team === team && m.bot);
        if (!bot) break;
        this.members = this.members.filter((m) => m !== bot);
      }
    }
    // Vẫn dư người thật → thử chuyển sang đội kia
    for (const team of [0, 1] as Team[]) {
      const other: Team = team === 0 ? 1 : 0;
      while (this.count(team) > size && this.count(other) < size) {
        const m = [...this.members].reverse().find((x) => x.team === team && !x.host)!;
        m.team = other;
      }
    }
    if (this.count(0) > size || this.count(1) > size) {
      this.changed();
      return 'Đang có quá nhiều người cho chế độ này.';
    }
    this.teamSize = size;
    this.changed();
    return null;
  }

  setMap(id: string) { this.mapId = id; this.changed(); }
  setBotDifficulty(d: Difficulty) { this.botDifficulty = d; this.changed(); }
  setFillBots(v: boolean) { this.fillBots = v; this.changed(); }

  addBot(team: Team) {
    if (this.count(team) >= this.teamSize) return;
    this.members.push({ key: `bot-${++this.botSeq}`, name: `Bot ${this.botSeq}`, team, bot: true, host: false, ping: null, conn: null, mods: {} });
    this.changed();
  }

  /** Xóa bot hoặc mời người chơi ra khỏi phòng. */
  remove(key: string) {
    const m = this.members.find((x) => x.key === key);
    if (!m || m.host) return;
    if (m.conn) this.reject(m.conn, 'Bạn đã bị chủ phòng mời ra.');
    this.members = this.members.filter((x) => x !== m);
    this.changed();
  }

  move(key: string) {
    const m = this.members.find((x) => x.key === key);
    if (!m) return;
    const other: Team = m.team === 0 ? 1 : 0;
    if (this.count(other) >= this.teamSize) return;
    m.team = other;
    this.changed();
  }

  canStart(): string | null {
    if (this.fillBots) return null;
    if (this.count(0) === 0 || this.count(1) === 0) return 'Mỗi đội cần ít nhất 1 người (hoặc bật tự thêm bot).';
    return null;
  }

  // ---------- Trận đấu ----------
  /** Bắt đầu trận: gửi đội hình cho mọi người, trả về đội hình + id của chủ phòng + id các bot. */
  start(): { roster: RosterInfo[]; hostId: number; botIds: number[] } {
    if (this.fillBots) {
      for (const team of [0, 1] as Team[]) {
        while (this.count(team) < this.teamSize) {
          this.members.push({ key: `bot-${++this.botSeq}`, name: `Bot ${this.botSeq}`, team, bot: true, host: false, ping: null, conn: null, mods: {} });
        }
      }
    }
    // Sắp xếp: đội 0 rồi đội 1, giữ thứ tự vào phòng
    const ordered = [...this.members.filter((m) => m.team === 0), ...this.members.filter((m) => m.team === 1)];
    const roster: RosterInfo[] = ordered.map((m) => ({ name: m.name, team: m.team, bot: m.bot, mods: m.mods }));
    this.idByKey.clear();
    this.queues.clear();
    ordered.forEach((m, i) => {
      this.idByKey.set(m.key, i);
      if (m.conn) this.queues.set(i, { q: [], last: { ...NO_INPUT }, ack: 0, lastRecv: performance.now() });
    });
    this.inGame = true;
    for (const m of ordered) {
      if (!m.conn) continue;
      this.send(m.conn, {
        t: 'start',
        start: { mapId: this.mapId, roster, you: this.idByKey.get(m.key)!, teamSize: this.teamSize, botDifficulty: this.botDifficulty },
      });
    }
    this.onChange();
    return {
      roster,
      hostId: this.idByKey.get('host')!,
      botIds: ordered.flatMap((m, i) => (m.bot ? [i] : [])),
    };
  }

  /** Input của người chơi online cho tick này (mỗi tick lấy 1 input trong hàng đợi). */
  inputFor(id: number): PlayerInput {
    const Q = this.queues.get(id);
    if (!Q) return NO_INPUT;
    // Hàng đợi dài (mạng giật) → gộp bớt, giữ các phím vừa nhấn
    while (Q.q.length > 4) {
      const a = Q.q.shift()!, next = Q.q[0];
      next.i.reload ||= a.i.reload;
      next.i.dash ||= a.i.dash;
      next.i.cycle ||= a.i.cycle;
      next.i.weapon ??= a.i.weapon;
    }
    const item = Q.q.shift();
    if (item) {
      Q.ack = item.s;
      Q.last = item.i;
      return item.i;
    }
    // Chưa có input mới: giữ hướng đi/bắn ngắn hạn, quá 250ms thì đứng yên
    if (performance.now() - Q.lastRecv > 250) return { ...NO_INPUT, aim: Q.last.aim };
    return { ...Q.last, reload: false, dash: false, cycle: false, weapon: null };
  }

  broadcastSnapshot(world: World, tick: number, events: GameEvent[]) {
    const base = makeSnapshot(world, tick, events);
    for (const m of this.members) {
      if (!m.conn?.open) continue;
      const id = this.idByKey.get(m.key);
      const ack = id === undefined ? 0 : this.queues.get(id)?.ack ?? 0;
      m.conn.send({ t: 'snap', s: { ...base, ack } } satisfies HostMsg);
    }
  }

  sendResult(r: ResultInfo) {
    for (const m of this.members) this.send(m.conn, { t: 'result', r });
  }

  /** Quay lại sảnh chờ sau trận. Người đã rời được xóa khỏi phòng. */
  backToLobby() {
    this.inGame = false;
    this.members = this.members.filter((m) => m.host || m.conn || (m.bot && m.key.startsWith('bot-')));
    this.idByKey.clear();
    this.queues.clear();
    this.changed();
  }

  close() {
    for (const m of this.members) this.send(m.conn, { t: 'closed', reason: 'Chủ phòng đã đóng phòng.' });
    setTimeout(() => this.peer.destroy(), 300);
  }
}
