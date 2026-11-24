import './style.css';
import { W, H, TICK, TEAM_NAMES, type Team } from './game/constants';
import { MAPS } from './game/map';
import { World, NO_INPUT, type GameEvent, type PlayerInput, type RosterEntry, type WorldView } from './game/world';
import { Bot, DIFFICULTY_LABEL, type Difficulty } from './game/bot';
import { MODS, WEAPON_ORDER } from './game/weapons';
import { Keyboard, KeyboardAim, keyboardInput, mouseInput, P1_KEYS, P2_KEYS } from './input';
import { Renderer } from './render';
import { AudioEngine, Sfx } from './sound';
import { Music } from './music';
import { Armory, renderProfile } from './armory';
import { LocalStore, type MatchRecord, type Mode, type SaveData, type TeamSizeSetting } from './storage';
import {
  applyMatch, botLoadout, buyMod, loadoutFromMods, modBlocker, playerLoadout, selectMod, selectedMods, standardLoadout,
  type MatchContext, type Rewards,
} from './progression';
import { NetHost } from './net/host';
import { NetClient, ClientWorld } from './net/client';
import { SNAPSHOT_EVERY, normalizeCode, type LobbyState, type ResultInfo, type StartInfo, type TeamSize } from './net/protocol';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- Khởi tạo ----------
const store = new LocalStore();
let data: SaveData = store.load();

const canvas = $<HTMLCanvasElement>('game');
canvas.width = W;
canvas.height = H;
const kb = new Keyboard(canvas);
const renderer = new Renderer(canvas);
const audio = new AudioEngine();
const sfx = new Sfx(audio);
const music = new Music(audio);

const ui = {
  name: $<HTMLInputElement>('name'),
  mode: $<HTMLSelectElement>('mode'),
  teamSize: $<HTMLSelectElement>('teamsize'),
  teamSizeWrap: $('teamsize-wrap'),
  difficulty: $<HTMLSelectElement>('difficulty'),
  difficultyWrap: $('difficulty-wrap'),
  p2name: $<HTMLInputElement>('p2name'),
  p2nameWrap: $('p2name-wrap'),
  map: $<HTMLSelectElement>('map'),
  controls: $('controls'),
  volume: $<HTMLInputElement>('volume'),
  music: $<HTMLInputElement>('music'),
  shake: $<HTMLInputElement>('shake'),
};

for (const m of MAPS) {
  ui.map.add(new Option(m.name, m.id));
  $<HTMLSelectElement>('lobby-map').add(new Option(m.name, m.id));
}

// ---------- Màn hình ----------
type ScreenId = 'menu' | 'history' | 'armory' | 'online' | 'result' | 'pause';
let currentScreen: ScreenId | null = 'menu';
function show(id: ScreenId | null) {
  currentScreen = id;
  if (id) $(id).scrollTop = 0;
  for (const el of document.querySelectorAll<HTMLElement>('.screen')) el.classList.toggle('hidden', el.id !== id);
  $('stage').classList.toggle('hidden', id === 'menu' || id === 'history' || id === 'armory' || id === 'online');
}

let toastTimer = 0;
function toast(msg: string, ms = 3000) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.add('hidden'), ms);
}

// ---------- Menu ----------
const CONTROLS: Record<'bot' | 'local', string> = {
  bot: `
    <b>Di chuyển</b> <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> ·
    <b>Ngắm</b> chuột · <b>Bắn</b> click trái ·
    <b>Nạp</b> <kbd>R</kbd> · <b>Lướt</b> <kbd>Shift</kbd><br>
    <b>Đổi súng</b> <kbd>1</kbd>–<kbd>5</kbd> / <kbd>Q</kbd> / lăn chuột ·
    <b>Menu</b> <kbd>Esc</kbd> · <b>Tắt tiếng</b> <kbd>M</kbd>`,
  local: `
    <span class="p1">● P1</span> <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> ·
    bắn <kbd>F</kbd> · lướt <kbd>G</kbd> · nạp <kbd>R</kbd> · đổi súng <kbd>Q</kbd><br>
    <span class="p2">● P2</span> mũi tên ·
    bắn <kbd>.</kbd> · lướt <kbd>/</kbd> · nạp <kbd>,</kbd> · đổi súng <kbd>L</kbd>
    (hoặc Numpad <kbd>0</kbd><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd>)<br>
    Nòng súng xoay theo hướng di chuyển, có hỗ trợ ngắm. <b>Tạm dừng</b> <kbd>Esc</kbd> · <b>Tắt tiếng</b> <kbd>M</kbd><br>
    <i>Giao hữu: cả hai dùng súng tiêu chuẩn, không tính thưởng.</i>`,
};

const canBuyAnyMod = () =>
  WEAPON_ORDER.some((id) => MODS[id].some((m) => !data.progress.mods[id].owned.includes(m.id) && !modBlocker(data.progress, id, m)));

function fillMenu() {
  const s = data.settings;
  ui.name.value = data.profile.name;
  ui.mode.value = s.mode === 'online' ? 'bot' : s.mode;
  ui.teamSize.value = String(s.teamSize);
  ui.difficulty.value = s.difficulty;
  ui.p2name.value = s.p2Name;
  ui.map.value = MAPS.some((m) => m.id === s.mapId) ? s.mapId : MAPS[0].id;
  ui.volume.value = String(s.volume);
  ui.music.value = String(s.musicVolume);
  ui.shake.checked = s.screenShake;
  renderProfile($('profile-bar'), data.progress);
  $('btn-armory').classList.toggle('has-dot', canBuyAnyMod());
  updateModeUi();
}

function updateModeUi() {
  const mode = ui.mode.value as 'bot' | 'local';
  ui.difficultyWrap.classList.toggle('hidden', mode !== 'bot');
  ui.teamSizeWrap.classList.toggle('hidden', mode !== 'bot');
  ui.p2nameWrap.classList.toggle('hidden', mode !== 'local');
  ui.controls.innerHTML = CONTROLS[mode];
}

function readMenu() {
  data.profile.name = ui.name.value.trim().slice(0, 20) || 'Người chơi 1';
  data.settings = {
    mode: ui.mode.value as Mode,
    teamSize: Number(ui.teamSize.value) as TeamSizeSetting,
    difficulty: ui.difficulty.value as Difficulty,
    mapId: ui.map.value,
    p2Name: ui.p2name.value.trim() || 'Người chơi 2',
    volume: Number(ui.volume.value),
    musicVolume: Number(ui.music.value),
    screenShake: ui.shake.checked,
  };
  store.save(data);
  applySettings();
}

function applySettings() {
  audio.sfxVolume = data.settings.volume;
  audio.musicVolume = data.settings.musicVolume;
  audio.applyVolumes();
  renderer.screenShake = data.settings.screenShake;
}

// Trình duyệt chỉ cho phát âm thanh sau thao tác đầu tiên của người dùng
for (const ev of ['pointerdown', 'keydown'] as const) window.addEventListener(ev, () => audio.ensure());

ui.volume.addEventListener('input', () => { audio.sfxVolume = Number(ui.volume.value); audio.applyVolumes(); });
ui.volume.addEventListener('change', () => sfx.gunshot('pistol'));
ui.music.addEventListener('input', () => { audio.musicVolume = Number(ui.music.value); audio.applyVolumes(); });

function toggleMute() {
  audio.muted = !audio.muted;
  audio.applyVolumes();
  $('mute').classList.toggle('hidden', !audio.muted);
}

ui.mode.addEventListener('change', () => { updateModeUi(); readMenu(); });
for (const el of [ui.name, ui.teamSize, ui.difficulty, ui.p2name, ui.map, ui.volume, ui.music, ui.shake]) el.addEventListener('change', readMenu);

// ---------- Phiên chơi ----------
type SessionKind = 'offline' | 'host' | 'client';

interface Session {
  kind: SessionKind;
  mode: Mode;
  difficulty: Difficulty;
  teamSize: number;
  view: WorldView;
  world: World | null;           // offline + chủ phòng
  client: ClientWorld | null;    // người vào phòng
  localIds: number[];            // người chơi điều khiển bằng bàn phím máy này
  me: number;                    // "bạn" (để tính thưởng, đánh dấu trên bản đồ)
  bots: Map<number, Bot>;
  aims: KeyboardAim[];
  endT: number;
  done: boolean;
  tick: number;
  pendingEvents: GameEvent[];
}

let session: Session | null = null;
let paused = false; // offline: tạm dừng thật; online: chỉ mở menu, trận vẫn chạy

function beginSession(s: Session) {
  session = s;
  audio.ensure();
  music.duck(false);
  music.play('battle');
  renderer.reset();
  kb.clear();
  kb.gameActive = true;
  paused = false;
  acc = 0;
  canvas.classList.toggle('no-cursor', s.mode !== 'local');
  $('net-status').classList.toggle('hidden', s.kind === 'offline');
  show(null);
}

function startOffline() {
  readMenu();
  const s = data.settings;
  const map = MAPS.find((m) => m.id === s.mapId) ?? MAPS[0];
  const roster: RosterEntry[] = [];
  const bots = new Map<number, Bot>();
  let localIds: number[];
  let teamSize = 1;

  if (s.mode === 'local') {
    roster.push({ name: data.profile.name, team: 0, weapons: standardLoadout() });
    roster.push({ name: s.p2Name, team: 1, weapons: standardLoadout() });
    localIds = [0, 1];
  } else {
    teamSize = s.teamSize;
    roster.push({ name: data.profile.name, team: 0, weapons: playerLoadout(data.progress) });
    for (let i = 1; i < teamSize; i++) roster.push({ name: `Đồng đội ${i}`, team: 0, weapons: botLoadout() });
    for (let i = 1; i <= teamSize; i++) roster.push({ name: teamSize === 1 ? `Bot ${DIFFICULTY_LABEL[s.difficulty]}` : `Địch ${i}`, team: 1, weapons: botLoadout() });
    roster.forEach((_, i) => { if (i > 0) bots.set(i, new Bot(i, s.difficulty)); });
    localIds = [0];
  }
  const world = new World(map, roster);
  beginSession({
    kind: 'offline', mode: s.mode === 'local' ? 'local' : 'bot', difficulty: s.difficulty, teamSize,
    view: world, world, client: null, localIds, me: 0, bots,
    aims: [new KeyboardAim(), new KeyboardAim()], endT: -1, done: false, tick: 0, pendingEvents: [],
  });
}

function localInput(s: Session, w: World, id: number): PlayerInput {
  const p = w.players[id];
  if (s.mode !== 'local') return mouseInput(kb, p);
  const enemy = w.players.find((o) => o.team !== p.team)!;
  return keyboardInput(kb, id === 0 ? P1_KEYS : P2_KEYS, s.aims[id], p, enemy, w);
}

function tick(s: Session) {
  if (s.kind === 'client') {
    const c = s.client!;
    const inp = paused ? { ...NO_INPUT, aim: c.me.aim } : mouseInput(kb, c.me);
    const seq = c.applyLocalInput(inp);
    net.client?.sendInput(seq, inp);
    handleEvents(s, c.drainEvents());
    return;
  }
  const w = s.world!;
  const inputs = w.players.map((p) => {
    const bot = s.bots.get(p.id);
    if (bot) return bot.think(w);
    if (s.localIds.includes(p.id)) return paused ? { ...NO_INPUT, aim: p.aim } : localInput(s, w, p.id);
    if (s.kind === 'host' && net.host) return net.host.inputFor(p.id);
    return NO_INPUT;
  });
  w.step(inputs);
  const evs = w.events.splice(0);
  handleEvents(s, evs);

  if (s.kind === 'host' && net.host) {
    s.pendingEvents.push(...evs);
    if (++s.tick % SNAPSHOT_EVERY === 0) {
      net.host.broadcastSnapshot(w, s.tick, s.pendingEvents);
      s.pendingEvents = [];
    }
  }
  if (evs.some((e) => e.type === 'matchEnd')) s.endT = 2.2;
  if (s.endT > 0) {
    s.endT -= TICK;
    if (s.endT <= 0) {
      const r = resultFromWorld(w);
      net.host?.sendResult(r);
      finishMatch(s, r);
    }
  }
}

function handleEvents(s: Session, evs: GameEvent[]) {
  if (!evs.length) return;
  renderer.onEvents(evs, s.view);
  sfx.onEvents(evs);
}

// ---------- Kết thúc trận ----------
function resultFromWorld(w: World): ResultInfo {
  return {
    winner: w.winner,
    score: w.score,
    roundWinners: w.rounds.map((r) => r.winner),
    stats: w.players.map((p) => [p.stats.shots, p.stats.hits, p.stats.damage, p.stats.kills, p.stats.deaths]),
    flawless: w.players.map((p) => w.rounds.some((r) => r.winner === p.team && r.damageTaken[p.id] === 0)),
    durationSec: Math.round(w.elapsed),
  };
}

function finishMatch(s: Session, r: ResultInfo) {
  if (s.done) return;
  s.done = true;
  kb.gameActive = false;
  canvas.classList.remove('no-cursor');
  if (paused) { paused = false; }

  const players = s.view.players;
  const myTeam: Team = players[s.me].team;
  const opp: Team = myTeam === 0 ? 1 : 0;
  const st = (id: number) => r.stats[id] ?? [0, 0, 0, 0, 0];
  const sum = (team: Team, k: number) => players.filter((p) => p.team === team).reduce((a, p) => a + st(p.id)[k], 0);
  const mine = st(s.me);
  const oppPlayers = players.filter((p) => p.team === opp);
  const relWinner = r.winner === null ? null : r.winner === myTeam ? 0 : 1;

  const rec: MatchRecord = {
    id: crypto.randomUUID?.() ?? String(Date.now()),
    date: new Date().toISOString(),
    mode: s.mode,
    difficulty: s.mode === 'bot' ? s.difficulty : undefined,
    mapId: s.view.map.id,
    mapName: s.view.map.name,
    teamSize: s.teamSize,
    players: [
      { name: players[s.me].name, score: r.score[myTeam], shots: mine[0], hits: mine[1], damage: mine[2], kills: mine[3], deaths: mine[4] },
      {
        name: oppPlayers.length === 1 ? oppPlayers[0].name : TEAM_NAMES[opp],
        score: r.score[opp], shots: sum(opp, 0), hits: sum(opp, 1), damage: sum(opp, 2), kills: sum(opp, 3), deaths: sum(opp, 4),
      },
    ],
    winner: relWinner,
    rounds: r.roundWinners.length,
    durationSec: r.durationSec,
  };
  data = store.addMatch(rec);

  music.play(null);
  music.stinger(relWinner === null ? 'draw' : s.mode === 'local' || relWinner === 0 ? 'win' : 'lose');
  setTimeout(() => { if (!session || session.done) music.play('menu'); }, 2600);

  let rewards: Rewards | null = null;
  if (s.mode !== 'local') {
    const ctx: MatchContext = {
      kind: s.mode === 'online' ? 'online' : s.difficulty,
      won: relWinner === 0,
      lost: relWinner === 1,
      myRounds: r.score[myTeam],
      oppRounds: r.score[opp],
      roundWinners: r.roundWinners.map((w) => (w === null ? null : w === myTeam ? 0 : 1)),
      flawlessRound: !!r.flawless[s.me],
      accuracy: mine[0] ? mine[1] / mine[0] : 0,
      kills: mine[3],
    };
    rewards = applyMatch(data.progress, ctx);
    store.save(data);
  }
  showResult(s, r, rewards);
}

function showResult(s: Session, r: ResultInfo, rewards: Rewards | null) {
  const players = s.view.players;
  const myTeam = players[s.me].team;
  const solo = s.teamSize === 1;
  let title: string;
  if (r.winner === null) title = 'Hòa!';
  else if (s.mode === 'local') title = `${players.find((p) => p.team === r.winner)!.name} thắng!`;
  else if (r.winner === myTeam) title = solo ? 'Bạn thắng! 🎉' : 'Đội bạn thắng! 🎉';
  else title = solo ? 'Bạn thua rồi' : 'Đội bạn thua rồi';
  $('result-title').textContent = title;
  const label = (t: Team) => (solo ? players.find((p) => p.team === t)!.name : TEAM_NAMES[t]);
  $('result-score').textContent = `${label(0)}  ${r.score[0]} : ${r.score[1]}  ${label(1)}`;

  const ordered = [...players].sort((a, b) => a.team - b.team || (r.stats[b.id]?.[3] ?? 0) - (r.stats[a.id]?.[3] ?? 0));
  $('result-body').replaceChildren(...ordered.map((p) => {
    const st = r.stats[p.id] ?? [0, 0, 0, 0, 0];
    const row = tr([p.id === s.me && s.mode !== 'local' ? `${p.name} (bạn)` : p.name, String(st[3]), String(st[4]), String(st[2]), pct(st[1], st[0])]);
    row.children[0].className = `team-${p.team}`;
    if (p.id === s.me && s.mode !== 'local') row.className = 'mine';
    return row;
  }));

  const box = $('result-rewards');
  box.replaceChildren();
  if (!rewards) {
    box.append(el('div', 'muted', 'Giao hữu — không tính thưởng.'));
  } else {
    box.append(el('div', 'big', `+${rewards.coins} xu · +${rewards.xp} XP`));
    if (rewards.levelAfter > rewards.levelBefore) box.append(el('div', 'lvup', `⬆ Lên cấp ${rewards.levelAfter}!`));
    for (const a of rewards.achievements) box.append(el('div', 'ach-line', `🏆 ${a.name} (+${a.reward} xu)`));
    if (canBuyAnyMod()) box.append(el('div', 'muted', 'Đủ xu mở chế độ súng mới — vào Kho vũ khí!'));
  }

  const rematch = $<HTMLButtonElement>('btn-rematch');
  const menuBtn = $<HTMLButtonElement>('btn-result-menu');
  rematch.classList.toggle('hidden', s.kind === 'client');
  rematch.textContent = s.kind === 'host' ? 'Về phòng chờ' : 'Chơi lại';
  menuBtn.textContent = s.kind === 'offline' ? 'Về menu' : 'Rời phòng';
  if (s.kind === 'client') box.append(el('div', 'muted', 'Chờ chủ phòng quay lại phòng chờ…'));
  show('result');
}

function quitToMenu() {
  session = null;
  paused = false;
  kb.gameActive = false;
  kb.clear();
  canvas.classList.remove('no-cursor');
  $('net-status').classList.add('hidden');
  music.duck(false);
  music.play('menu');
  fillMenu();
  show('menu');
}

function setPaused(v: boolean) {
  const s = session;
  if (!s || s.done) return;
  const online = s.kind !== 'offline';
  paused = v;
  kb.clear();
  kb.gameActive = !v;
  if (!online) music.duck(v);
  $('pause-title').textContent = online ? 'Menu' : 'Tạm dừng';
  $('pause-note').classList.toggle('hidden', !online);
  $('btn-resume').textContent = online ? 'Quay lại trận (Esc)' : 'Tiếp tục (Esc)';
  $('btn-quit').textContent = online ? 'Rời trận' : 'Bỏ trận, về menu';
  show(v ? 'pause' : null);
}

window.addEventListener('keydown', (e) => {
  if ((e.code === 'Escape' || e.code === 'KeyP') && session && !session.done) setPaused(!paused);
  // Esc ở các trang phụ → về menu (trừ khi đang trong phòng online)
  const inRoom = !!(net.host || net.client);
  if (e.code === 'Escape' && !session && (currentScreen === 'armory' || currentScreen === 'history' || (currentScreen === 'online' && !inRoom))) {
    fillMenu();
    show('menu');
  }
  if (e.code === 'KeyM' && !(e.target instanceof HTMLInputElement)) toggleMute();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && session?.kind === 'offline') setPaused(true);
});

// ---------- Online ----------
const net: { host: NetHost | null; client: NetClient | null } = { host: null, client: null };

function myMods() { return selectedMods(data.progress); }

function setStatus(id: string, msg: string, error = false) {
  const e = $(id);
  e.textContent = msg;
  e.classList.toggle('error', error);
}

function openOnline(code = '') {
  readMenu();
  $('online-entry').classList.remove('hidden');
  $('online-lobby').classList.add('hidden');
  setStatus('online-status', '');
  if (code) $<HTMLInputElement>('room-code').value = code;
  show('online');
  if (code) $('btn-join').focus();
}

function showLobby() {
  $('online-entry').classList.add('hidden');
  $('online-lobby').classList.remove('hidden');
  renderLobby();
  show('online');
}

async function createRoom() {
  if (net.host || net.client) return;
  setStatus('online-status', 'Đang tạo phòng…');
  try {
    const host = await NetHost.create(data.profile.name, myMods(), data.settings.mapId);
    net.host = host;
    host.onChange = () => { if (!session || session.done) renderLobby(); };
    host.onPlayerLeft = (id) => {
      session?.bots.set(id, new Bot(id, host.botDifficulty));
      const p = session?.view.players[id];
      if (p) { toast(`${p.name} đã rời trận — bot thay thế.`); p.name = `${p.name} (bot)`; }
    };
    host.onError = (msg) => { if (msg !== 'peer-unavailable') toast(`Kết nối: ${msg}`); };
    history.replaceState(null, '', `?room=${host.code}`);
    showLobby();
  } catch (err) {
    setStatus('online-status', (err as Error).message, true);
  }
}

async function joinRoom() {
  if (net.host || net.client) return;
  const code = normalizeCode($<HTMLInputElement>('room-code').value);
  if (code.length !== 5) { setStatus('online-status', 'Mã phòng gồm 5 ký tự.', true); return; }
  setStatus('online-status', `Đang vào phòng ${code}…`);
  try {
    const client = await NetClient.join(code, data.profile.name, myMods());
    net.client = client;
    client.onLobby = (l) => {
      // Chủ phòng quay về phòng chờ → mọi người theo
      if (session && session.kind === 'client' && !l.inGame && session.done) { session = null; music.play('menu'); showLobby(); return; }
      if (!session) renderLobby();
    };
    client.onStart = (start) => startClientMatch(start);
    client.onSnapshot = (snap) => session?.client?.onSnapshot(snap);
    client.onResult = (r) => { if (session?.kind === 'client') finishMatch(session, r); };
    client.onClosed = (reason) => {
      net.client = null;
      toast(reason, 4500);
      session = null;
      openOnline();
      setStatus('online-status', reason, true);
      music.play('menu');
      kb.gameActive = false;
      $('net-status').classList.add('hidden');
    };
    history.replaceState(null, '', `?room=${code}`);
    if (client.lobby) renderLobby();
    showLobby();
  } catch (err) {
    setStatus('online-status', (err as Error).message, true);
  }
}

function currentLobby(): LobbyState | null {
  return net.host?.lobby ?? net.client?.lobby ?? null;
}

function renderLobby() {
  const lobby = currentLobby();
  if (!lobby) return;
  const isHost = !!net.host;
  const myKey = isHost ? 'host' : net.client!.key;
  $('lobby-code').textContent = lobby.code;

  const size = $<HTMLSelectElement>('lobby-size'), map = $<HTMLSelectElement>('lobby-map');
  const bot = $<HTMLSelectElement>('lobby-bot'), fill = $<HTMLInputElement>('lobby-fill');
  size.value = String(lobby.teamSize); map.value = lobby.mapId; bot.value = lobby.botDifficulty; fill.checked = lobby.fillBots;
  for (const e of [size, map, bot, fill]) e.disabled = !isHost;

  for (const team of [0, 1] as Team[]) {
    const slots = lobby.slots.filter((s) => s.team === team);
    $(`team${team}-count`).textContent = `${slots.length}/${lobby.teamSize}`;
    const rows: HTMLElement[] = slots.map((s) => {
      const row = el('div', 'slot', '');
      row.append(el('span', 'sname', `${s.bot ? '🤖 ' : ''}${s.name}`));
      if (s.key === myKey) row.append(el('span', 'tag me', 'Bạn'));
      if (s.host) row.append(el('span', 'tag host', 'Chủ phòng'));
      if (s.ping !== null && !s.bot) row.append(el('span', 'ping', `${s.ping}ms`));
      if (isHost && !s.host) {
        const mv = el('button', 'ghost', '⇄') as HTMLButtonElement;
        mv.title = 'Chuyển đội';
        mv.addEventListener('click', () => net.host?.move(s.key));
        const rm = el('button', 'ghost', '✕') as HTMLButtonElement;
        rm.title = s.bot ? 'Xóa bot' : 'Mời ra khỏi phòng';
        rm.addEventListener('click', () => {
          if (s.bot || confirm(`Mời ${s.name} ra khỏi phòng?`)) net.host?.remove(s.key);
        });
        row.append(mv, rm);
      }
      return row;
    });
    for (let i = slots.length; i < lobby.teamSize; i++) {
      const row = el('div', 'slot empty', lobby.fillBots ? 'Trống (bot sẽ vào khi bắt đầu)' : 'Trống');
      if (isHost) {
        const add = el('button', 'ghost', '+ Bot') as HTMLButtonElement;
        add.style.marginLeft = 'auto';
        add.addEventListener('click', () => net.host?.addBot(team));
        row.append(add);
      }
      rows.push(row);
    }
    $(`team${team}`).replaceChildren(...rows);
  }

  const startBtn = $<HTMLButtonElement>('btn-lobby-start');
  startBtn.classList.toggle('hidden', !isHost);
  const humans = lobby.slots.filter((s) => !s.bot).length;
  if (isHost) {
    const blocker = net.host!.canStart();
    startBtn.disabled = !!blocker;
    setStatus('lobby-status', blocker ?? (humans === 1 ? 'Gửi mã phòng cho bạn bè, hoặc bắt đầu luôn với bot.' : `${humans} người trong phòng — sẵn sàng!`), !!blocker);
  } else {
    setStatus('lobby-status', 'Chờ chủ phòng bắt đầu trận…');
  }
}

$<HTMLSelectElement>('lobby-size').addEventListener('change', (e) => {
  const err = net.host?.setTeamSize(Number((e.target as HTMLSelectElement).value) as TeamSize);
  if (err) { toast(err); renderLobby(); }
});
$<HTMLSelectElement>('lobby-map').addEventListener('change', (e) => net.host?.setMap((e.target as HTMLSelectElement).value));
$<HTMLSelectElement>('lobby-bot').addEventListener('change', (e) => net.host?.setBotDifficulty((e.target as HTMLSelectElement).value as Difficulty));
$<HTMLInputElement>('lobby-fill').addEventListener('change', (e) => net.host?.setFillBots((e.target as HTMLInputElement).checked));

$('btn-switch-team').addEventListener('click', () => {
  const lobby = currentLobby();
  if (!lobby) return;
  if (net.host) { net.host.move('host'); return; }
  const me = lobby.slots.find((s) => s.key === net.client!.key);
  if (me) net.client!.requestTeam(me.team === 0 ? 1 : 0);
});

$('btn-copy-link').addEventListener('click', async () => {
  const lobby = currentLobby();
  if (!lobby) return;
  const link = `${location.origin}${location.pathname}?room=${lobby.code}`;
  try {
    await navigator.clipboard.writeText(link);
    toast('Đã sao chép link mời — gửi cho bạn bè!');
  } catch {
    prompt('Sao chép link này:', link);
  }
});

function startHostMatch() {
  const host = net.host;
  if (!host || host.canStart()) return;
  const { roster, hostId, botIds } = host.start();
  const map = MAPS.find((m) => m.id === host.mapId) ?? MAPS[0];
  const world = new World(map, roster.map((r) => ({ name: r.name, team: r.team, weapons: r.bot ? botLoadout() : loadoutFromMods(r.mods) })));
  const bots = new Map<number, Bot>(botIds.map((id) => [id, new Bot(id, host.botDifficulty)]));
  beginSession({
    kind: 'host', mode: 'online', difficulty: host.botDifficulty, teamSize: host.teamSize,
    view: world, world, client: null, localIds: [hostId], me: hostId, bots,
    aims: [], endT: -1, done: false, tick: 0, pendingEvents: [],
  });
}

function startClientMatch(start: StartInfo) {
  const cw = new ClientWorld(start);
  beginSession({
    kind: 'client', mode: 'online', difficulty: start.botDifficulty, teamSize: start.teamSize,
    view: cw, world: null, client: cw, localIds: [start.you], me: start.you, bots: new Map(),
    aims: [], endT: -1, done: false, tick: 0, pendingEvents: [],
  });
}

function leaveOnline() {
  net.host?.close();
  net.client?.leave();
  net.host = null;
  net.client = null;
  history.replaceState(null, '', location.pathname);
  quitToMenu();
}

$('btn-online').addEventListener('click', () => openOnline());
$('btn-online-back').addEventListener('click', () => { fillMenu(); show('menu'); });
$('btn-create').addEventListener('click', createRoom);
$('btn-join').addEventListener('click', joinRoom);
$<HTMLInputElement>('room-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });
$('btn-leave').addEventListener('click', () => {
  if (net.host && currentLobby()!.slots.some((s) => !s.bot && !s.host) && !confirm('Rời phòng sẽ đóng phòng với mọi người. Tiếp tục?')) return;
  leaveOnline();
});
$('btn-lobby-start').addEventListener('click', startHostMatch);
window.addEventListener('beforeunload', () => { net.host?.close(); net.client?.leave(); });

// Chủ phòng chạy mô phỏng bằng bộ đếm trong Web Worker → trận không bị đứng khi chuyển tab
const hostClock = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 8)'], { type: 'text/javascript' })));
let hostLast = performance.now();
let hostAcc = 0;
hostClock.onmessage = () => {
  const now = performance.now();
  const s = session;
  if (!s || s.kind !== 'host' || s.done) { hostLast = now; hostAcc = 0; return; }
  hostAcc += Math.min(0.25, (now - hostLast) / 1000);
  hostLast = now;
  let n = 0;
  while (hostAcc >= TICK && n++ < 10) {
    tick(s);
    kb.endTick();
    hostAcc -= TICK;
    if (s.done) break;
  }
};

// ---------- Lịch sử ----------
function modeLabel(m: MatchRecord): string {
  const size = m.teamSize && m.teamSize > 1 ? ` · ${m.teamSize}vs${m.teamSize}` : '';
  if (m.mode === 'online') return `Online${size || ' · 1vs1'}`;
  if (m.mode === 'local') return '2 người';
  return `Bot ${DIFFICULTY_LABEL[m.difficulty ?? 'normal']}${size}`;
}

function renderHistory() {
  const s = data.stats;
  const stats: [string, string][] = [
    ['Số trận', String(s.matches)],
    ['Thắng / Thua / Hòa', `${s.wins} / ${s.losses} / ${s.draws}`],
    ['Tỉ lệ thắng', pct(s.wins, s.matches)],
    ['K/D', s.deaths ? (s.kills / s.deaths).toFixed(2) : String(s.kills)],
    ['Chính xác', pct(s.hits, s.shots)],
    ['Tổng sát thương', String(s.damage)],
  ];
  $('stats-summary').replaceChildren(...stats.map(([k, v]) => {
    const div = el('div', 'stat', '');
    div.append(el('div', 'v', v), el('div', 'k', k));
    return div;
  }));

  const body = $('history-body');
  if (!data.history.length) {
    const row = tr(['Chưa có trận nào. Chơi một trận đi!']);
    row.firstElementChild!.setAttribute('colspan', '8');
    row.firstElementChild!.className = 'empty';
    body.replaceChildren(row);
    return;
  }
  body.replaceChildren(...data.history.map((m) => {
    const [me, op] = m.players;
    const result = m.winner === 0 ? 'Thắng' : m.winner === 1 ? 'Thua' : 'Hòa';
    const row = tr([
      new Date(m.date).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }),
      modeLabel(m), op.name, m.mapName, `${me.score} : ${op.score}`, result, `${me.kills} / ${me.deaths}`, pct(me.hits, me.shots),
    ]);
    row.children[5].className = m.winner === 0 ? 'win' : m.winner === 1 ? 'loss' : 'draw';
    return row;
  }));
}

$('btn-history').addEventListener('click', () => { readMenu(); renderHistory(); show('history'); });
$('btn-history-back').addEventListener('click', () => { fillMenu(); show('menu'); });
$('btn-history-top').addEventListener('click', () => { fillMenu(); show('menu'); });
$('btn-clear').addEventListener('click', () => {
  if (confirm('Xóa toàn bộ lịch sử và thống kê? (Xu, cấp độ và chế độ súng được giữ lại)')) { data = store.reset(); renderHistory(); }
});
$('btn-export').addEventListener('click', () => {
  const blob = new Blob([store.exportJSON()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `dau-sung-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});
const importFile = $<HTMLInputElement>('import-file');
$('btn-import').addEventListener('click', () => importFile.click());
importFile.addEventListener('change', async () => {
  const file = importFile.files?.[0];
  importFile.value = '';
  if (!file) return;
  try {
    data = store.importJSON(await file.text());
    applySettings();
    renderHistory();
    toast('Đã nhập dữ liệu.');
  } catch (err) {
    alert(`Không nhập được: ${(err as Error).message}`);
  }
});

// ---------- Kho vũ khí ----------
const armory = new Armory($('armory'), {
  getProgress: () => data.progress,
  onBuy: (id, modId) => {
    const gained = buyMod(data.progress, id, modId);
    store.save(data);
    sfx.upgrade();
    armory.render();
    for (const a of gained) toast(`🏆 Thành tựu: ${a.name} (+${a.reward} xu)`);
  },
  onSelect: (id, modId) => {
    selectMod(data.progress, id, modId);
    store.save(data);
    sfx.click();
    armory.render();
  },
});

$('btn-armory').addEventListener('click', () => { readMenu(); armory.render(); show('armory'); });
$('btn-armory-back').addEventListener('click', () => { fillMenu(); show('menu'); });

// ---------- Nút khác ----------
$('btn-start').addEventListener('click', startOffline);
$('btn-rematch').addEventListener('click', () => {
  if (session?.kind === 'host' && net.host) {
    session = null;
    net.host.backToLobby();
    music.play('menu');
    showLobby();
  } else {
    startOffline();
  }
});
$('btn-result-menu').addEventListener('click', () => (session && session.kind !== 'offline' ? leaveOnline() : quitToMenu()));
$('btn-resume').addEventListener('click', () => setPaused(false));
$('btn-quit').addEventListener('click', () => {
  if (session && session.kind !== 'offline') {
    if (net.host && !confirm('Bạn là chủ phòng — rời trận sẽ kết thúc trận với mọi người. Tiếp tục?')) return;
    leaveOnline();
  } else {
    quitToMenu();
  }
});

// ---------- Vòng lặp hiển thị ----------
let last = performance.now();
let acc = 0;
let statusT = 0;
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const s = session;
  if (s) {
    const online = s.kind !== 'offline';
    // Chủ phòng được chạy bởi hostClock; offline + người vào phòng chạy theo khung hình
    if (s.kind !== 'host') {
      if (!s.done && (online || !paused)) {
        acc += dt;
        while (acc >= TICK) {
          tick(s);
          kb.endTick();
          acc -= TICK;
          if (s.done) break;
        }
      } else {
        acc = 0;
      }
    }
    s.client?.updateView(dt);
    if (online || !paused) renderer.update(dt);
    const me = s.view.players[s.me];
    renderer.draw(s.view, {
      crosshair: s.mode !== 'local' && !s.done && !paused && me?.alive ? { x: kb.mouseX, y: kb.mouseY } : null,
      focus: s.localIds,
      me: s.mode === 'local' ? null : s.me,
    });
    statusT -= dt;
    if (online && statusT <= 0) {
      statusT = 0.5;
      const lobby = currentLobby();
      $('net-status').textContent = net.host
        ? `Chủ phòng · Phòng ${lobby?.code ?? ''}`
        : `Phòng ${lobby?.code ?? ''} · Ping ${net.client?.rtt ? Math.round(net.client.rtt) : '…'}ms`;
    }
  }
  requestAnimationFrame(frame);
}

// ---------- Tiện ích ----------
function pct(a: number, b: number) { return b ? `${Math.round((a / b) * 100)}%` : '—'; }
function el(tag: string, cls: string, text: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.textContent = text;
  return e;
}
function tr(cells: string[]) {
  const row = document.createElement('tr');
  for (const c of cells) {
    const td = document.createElement('td');
    td.textContent = c;
    row.append(td);
  }
  return row;
}

applySettings();
fillMenu();
show('menu');
music.play('menu');
for (const b of document.querySelectorAll('button')) b.addEventListener('click', () => sfx.click());
const roomParam = normalizeCode(new URLSearchParams(location.search).get('room') ?? '');
if (roomParam.length === 5) openOnline(roomParam);
requestAnimationFrame(frame);
