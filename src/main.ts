import './style.css';
import { W, H, TICK } from './game/constants';
import { MAPS } from './game/map';
import { World } from './game/world';
import { Bot, DIFFICULTY_LABEL, type Difficulty } from './game/bot';
import { Keyboard, KeyboardAim, keyboardInput, mouseInput, P1_KEYS, P2_KEYS } from './input';
import { Renderer } from './render';
import { Sfx } from './sound';
import { LocalStore, type MatchRecord, type Mode, type SaveData } from './storage';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- Khởi tạo ----------
const store = new LocalStore();
let data: SaveData = store.load();

const canvas = $<HTMLCanvasElement>('game');
canvas.width = W;
canvas.height = H;
const kb = new Keyboard(canvas);
const renderer = new Renderer(canvas);
const sfx = new Sfx();

const ui = {
  name: $<HTMLInputElement>('name'),
  mode: $<HTMLSelectElement>('mode'),
  difficulty: $<HTMLSelectElement>('difficulty'),
  difficultyWrap: $('difficulty-wrap'),
  p2name: $<HTMLInputElement>('p2name'),
  p2nameWrap: $('p2name-wrap'),
  map: $<HTMLSelectElement>('map'),
  controls: $('controls'),
  volume: $<HTMLInputElement>('volume'),
  shake: $<HTMLInputElement>('shake'),
};

for (const m of MAPS) ui.map.add(new Option(m.name, m.id));

// ---------- Màn hình ----------
type ScreenId = 'menu' | 'history' | 'result' | 'pause';
function show(id: ScreenId | null) {
  for (const el of document.querySelectorAll<HTMLElement>('.screen')) el.classList.toggle('hidden', el.id !== id);
  $('stage').classList.toggle('hidden', id === 'menu' || id === 'history');
}

// ---------- Menu ----------
const CONTROLS: Record<Mode, string> = {
  bot: `
    <b>Di chuyển</b> <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> ·
    <b>Ngắm</b> chuột · <b>Bắn</b> click trái ·
    <b>Nạp</b> <kbd>R</kbd> · <b>Lướt</b> <kbd>Shift</kbd><br>
    <b>Đổi súng</b> <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> / <kbd>Q</kbd> / lăn chuột ·
    <b>Tạm dừng</b> <kbd>Esc</kbd>`,
  local: `
    <span class="p1">● P1</span> <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> ·
    bắn <kbd>F</kbd> · lướt <kbd>G</kbd> · nạp <kbd>R</kbd> · đổi súng <kbd>Q</kbd><br>
    <span class="p2">● P2</span> mũi tên ·
    bắn <kbd>.</kbd> · lướt <kbd>/</kbd> · nạp <kbd>,</kbd> · đổi súng <kbd>L</kbd>
    (hoặc Numpad <kbd>0</kbd><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd>)<br>
    Nòng súng xoay theo hướng di chuyển, có hỗ trợ ngắm. <b>Tạm dừng</b> <kbd>Esc</kbd>`,
};

function fillMenu() {
  const s = data.settings;
  ui.name.value = data.profile.name;
  ui.mode.value = s.mode;
  ui.difficulty.value = s.difficulty;
  ui.p2name.value = s.p2Name;
  ui.map.value = MAPS.some((m) => m.id === s.mapId) ? s.mapId : MAPS[0].id;
  ui.volume.value = String(s.volume);
  ui.shake.checked = s.screenShake;
  updateModeUi();
}

function updateModeUi() {
  const mode = ui.mode.value as Mode;
  ui.difficultyWrap.classList.toggle('hidden', mode !== 'bot');
  ui.p2nameWrap.classList.toggle('hidden', mode !== 'local');
  ui.controls.innerHTML = CONTROLS[mode];
}

function readMenu() {
  data.profile.name = ui.name.value.trim() || 'Người chơi 1';
  data.settings = {
    mode: ui.mode.value as Mode,
    difficulty: ui.difficulty.value as Difficulty,
    mapId: ui.map.value,
    p2Name: ui.p2name.value.trim() || 'Người chơi 2',
    volume: Number(ui.volume.value),
    screenShake: ui.shake.checked,
  };
  store.save(data);
  applySettings();
}

function applySettings() {
  sfx.volume = data.settings.volume;
  renderer.screenShake = data.settings.screenShake;
}

ui.mode.addEventListener('change', () => { updateModeUi(); readMenu(); });
for (const el of [ui.name, ui.difficulty, ui.p2name, ui.map, ui.volume, ui.shake]) el.addEventListener('change', readMenu);

// ---------- Trận đấu ----------
interface Session {
  world: World;
  mode: Mode;
  difficulty: Difficulty;
  bot: Bot | null;
  aims: [KeyboardAim, KeyboardAim];
  endT: number; // đếm ngược hiện màn kết quả sau khi trận kết thúc
  done: boolean;
}

let session: Session | null = null;
let paused = false;

function startMatch() {
  readMenu();
  sfx.ensure();
  const s = data.settings;
  const map = MAPS.find((m) => m.id === s.mapId) ?? MAPS[0];
  const p2 = s.mode === 'bot' ? `Bot ${DIFFICULTY_LABEL[s.difficulty]}` : s.p2Name;
  session = {
    world: new World(map, [data.profile.name, p2]),
    mode: s.mode,
    difficulty: s.difficulty,
    bot: s.mode === 'bot' ? new Bot(1, s.difficulty) : null,
    aims: [new KeyboardAim(), new KeyboardAim()],
    endT: -1,
    done: false,
  };
  renderer.reset();
  kb.clear();
  kb.gameActive = true;
  paused = false;
  canvas.classList.toggle('no-cursor', s.mode === 'bot');
  show(null);
}

function tick(s: Session) {
  const w = s.world;
  const [p0, p1] = w.players;
  const i0 = s.mode === 'bot' ? mouseInput(kb, p0) : keyboardInput(kb, P1_KEYS, s.aims[0], p0, p1, w);
  const i1 = s.bot ? s.bot.think(w) : keyboardInput(kb, P2_KEYS, s.aims[1], p1, p0, w);
  w.step([i0, i1]);
  renderer.onEvents(w.events, w);
  sfx.onEvents(w.events);
  if (w.events.some((e) => e.type === 'matchEnd')) s.endT = 2.2;
  w.events.length = 0;

  if (s.endT > 0) {
    s.endT -= TICK;
    if (s.endT <= 0) finishMatch(s);
  }
}

function finishMatch(s: Session) {
  s.done = true;
  kb.gameActive = false;
  canvas.classList.remove('no-cursor');
  const w = s.world;
  const rec: MatchRecord = {
    id: crypto.randomUUID?.() ?? String(Date.now()),
    date: new Date().toISOString(),
    mode: s.mode,
    difficulty: s.mode === 'bot' ? s.difficulty : undefined,
    mapId: w.map.id,
    mapName: w.map.name,
    players: [0, 1].map((i) => {
      const p = w.players[i];
      return { name: p.name, score: w.score[i], ...p.stats };
    }) as MatchRecord['players'],
    winner: w.winner,
    rounds: w.rounds.length,
    durationSec: Math.round(w.elapsed),
  };
  data = store.addMatch(rec);
  showResult(rec);
}

function showResult(rec: MatchRecord) {
  const [a, b] = rec.players;
  $('result-title').textContent = rec.winner === null ? 'Hòa!' : `${rec.players[rec.winner].name} thắng!`;
  $('result-score').textContent = `${a.score} : ${b.score}`;
  $('result-p0').textContent = a.name;
  $('result-p1').textContent = b.name;
  const rows: [string, (p: MatchRecord['players'][0]) => string][] = [
    ['Hạ gục', (p) => String(p.kills)],
    ['Bị hạ', (p) => String(p.deaths)],
    ['Sát thương', (p) => String(p.damage)],
    ['Đạn bắn', (p) => String(p.shots)],
    ['Chính xác', (p) => pct(p.hits, p.shots)],
  ];
  const body = $('result-body');
  body.replaceChildren(...rows.map(([label, f]) => tr([label, f(a), f(b)])));
  show('result');
}

function quitToMenu() {
  session = null;
  paused = false;
  kb.gameActive = false;
  kb.clear();
  canvas.classList.remove('no-cursor');
  fillMenu();
  show('menu');
}

function setPaused(v: boolean) {
  if (!session || session.done) return;
  paused = v;
  kb.clear();
  kb.gameActive = !v;
  show(v ? 'pause' : null);
}

window.addEventListener('keydown', (e) => {
  if ((e.code === 'Escape' || e.code === 'KeyP') && session && !session.done) setPaused(!paused);
});
document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true); });

// ---------- Lịch sử ----------
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
    const div = document.createElement('div');
    div.className = 'stat';
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
      m.mode === 'bot' ? `Bot · ${DIFFICULTY_LABEL[m.difficulty ?? 'normal']}` : '2 người',
      op.name,
      m.mapName,
      `${me.score} : ${op.score}`,
      result,
      `${me.kills} / ${me.deaths}`,
      pct(me.hits, me.shots),
    ]);
    row.children[5].className = m.winner === 0 ? 'win' : m.winner === 1 ? 'loss' : 'draw';
    return row;
  }));
}

$('btn-history').addEventListener('click', () => { readMenu(); renderHistory(); show('history'); });
$('btn-history-back').addEventListener('click', () => { fillMenu(); show('menu'); });
$('btn-clear').addEventListener('click', () => {
  if (confirm('Xóa toàn bộ lịch sử và thống kê? Không thể hoàn tác.')) { data = store.reset(); renderHistory(); }
});
$('btn-export').addEventListener('click', () => {
  const blob = new Blob([store.exportJSON()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `dau-sung-1vs1-${new Date().toISOString().slice(0, 10)}.json`;
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
    alert('Đã nhập dữ liệu.');
  } catch (err) {
    alert(`Không nhập được: ${(err as Error).message}`);
  }
});

// ---------- Nút khác ----------
$('btn-start').addEventListener('click', startMatch);
$('btn-rematch').addEventListener('click', startMatch);
$('btn-result-menu').addEventListener('click', quitToMenu);
$('btn-resume').addEventListener('click', () => setPaused(false));
$('btn-quit').addEventListener('click', quitToMenu);

// ---------- Vòng lặp ----------
let last = performance.now();
let acc = 0;
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const s = session;
  if (s) {
    if (!paused && !s.done) {
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
    if (!paused) renderer.update(dt);
    renderer.draw(s.world, s.mode === 'bot' && !s.done && !paused ? { x: kb.mouseX, y: kb.mouseY } : null);
  }
  requestAnimationFrame(frame);
}

// ---------- Tiện ích ----------
function pct(a: number, b: number) { return b ? `${Math.round((a / b) * 100)}%` : '—'; }
function el(tag: string, cls: string, text: string) {
  const e = document.createElement(tag);
  e.className = cls;
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
requestAnimationFrame(frame);
