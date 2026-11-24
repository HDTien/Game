import { AudioEngine, midi, playNoise, playTone } from './sound';

/**
 * Nhạc nền tổng hợp theo thời gian thực (sequencer 16 bước / ô nhịp).
 * - menu:   nhẹ nhàng, 84 BPM, hợp âm Am7 – Fmaj7 – Cmaj7 – Em7
 * - battle: dồn dập, 128 BPM, Am – F – C – G, có các đoạn intro / cao trào / lắng
 */
export type Track = 'menu' | 'battle';

const BATTLE = {
  bpm: 128,
  lead: [[69, 72, 76], [65, 69, 72], [67, 72, 76], [67, 71, 74]],
  bass: [45, 41, 48, 43],
  bassPattern: [0, null, 0, null, 12, null, 0, 0, null, 0, null, 0, 12, null, 0, 7] as (number | null)[],
  arp: [0, 2, 1, 2, 0, 2, 1, 2],
};

const MENU = {
  bpm: 84,
  chords: [[57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 60, 64], [52, 55, 59, 62]],
  bass: [45, 41, 48, 40],
  arp: [0, 1, 2, 3, 2, 1, 2, 3],
};

export class Music {
  private track: Track | null = null;
  private wanted: Track | null = null;
  private bus: GainNode | null = null;
  private timer: number | null = null;
  private nextTime = 0;
  private step = 0;
  private ducked = false;

  constructor(private a: AudioEngine) {
    a.onReady(() => this.apply());
  }

  play(track: Track | null) {
    this.wanted = track;
    this.apply();
  }

  /** Giảm nhỏ nhạc (khi tạm dừng). */
  duck(on: boolean) {
    this.ducked = on;
    const ctx = this.a.ctx;
    if (ctx && this.bus) this.bus.gain.setTargetAtTime(on ? 0.3 : 1, ctx.currentTime, 0.15);
  }

  /** Đoạn nhạc ngắn khi kết thúc trận. */
  stinger(kind: 'win' | 'lose' | 'draw') {
    const ctx = this.a.ctx;
    if (!ctx) return;
    const out = this.a.musicBus;
    const notes = kind === 'win' ? [72, 76, 79, 84] : kind === 'lose' ? [67, 63, 60, 55] : [67, 67, 65];
    const step = kind === 'lose' ? 0.22 : 0.12;
    notes.forEach((n, i) => {
      playTone(this.a, out, { freq: midi(n), dur: 0.35, gain: 0.22, type: 'square', filter: 2800, at: i * step });
      playTone(this.a, out, { freq: midi(n - 12), dur: 0.35, gain: 0.15, type: 'triangle', at: i * step });
    });
    const end = notes.length * step;
    const chord = kind === 'win' ? [72, 76, 79] : kind === 'lose' ? [55, 58, 62] : [60, 65, 67];
    for (const n of chord) playTone(this.a, out, { freq: midi(n), dur: 1.4, gain: 0.1, type: 'sawtooth', filter: 1800, at: end, attack: 0.02 });
  }

  private apply() {
    const ctx = this.a.ctx;
    if (!ctx || this.wanted === this.track) return;
    // Mờ dần bản cũ
    if (this.bus) {
      const old = this.bus;
      old.gain.setTargetAtTime(0, ctx.currentTime, 0.25);
      setTimeout(() => old.disconnect(), 1500);
      this.bus = null;
    }
    this.track = this.wanted;
    if (!this.track) {
      if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
      return;
    }
    this.bus = ctx.createGain();
    this.bus.gain.setValueAtTime(0, ctx.currentTime);
    this.bus.gain.setTargetAtTime(this.ducked ? 0.3 : 1, ctx.currentTime + 0.05, 0.4);
    this.bus.connect(this.a.musicBus);
    this.step = 0;
    this.nextTime = ctx.currentTime + 0.1;
    if (this.timer === null) this.timer = window.setInterval(() => this.schedule(), 25);
  }

  /** Lên lịch trước ~150ms để nhịp chính xác dù main thread bận. */
  private schedule() {
    const ctx = this.a.ctx;
    if (!ctx || !this.track || !this.bus) return;
    if (ctx.state !== 'running') { this.nextTime = ctx.currentTime + 0.1; return; }
    if (this.nextTime < ctx.currentTime - 0.5) this.nextTime = ctx.currentTime + 0.05; // tab bị treo lâu → bắt nhịp lại
    const bpm = this.track === 'battle' ? BATTLE.bpm : MENU.bpm;
    const stepDur = 60 / bpm / 4;
    while (this.nextTime < ctx.currentTime + 0.15) {
      const at = this.nextTime - ctx.currentTime;
      if (this.track === 'battle') this.battleStep(this.step, at, stepDur);
      else this.menuStep(this.step, at, stepDur);
      this.nextTime += stepDur;
      this.step++;
    }
  }

  // ---------- Nhạc cụ ----------
  private kick(at: number, g = 1) {
    playTone(this.a, this.bus!, { freq: 150, to: 42, dur: 0.3, gain: 0.85 * g, at });
  }
  private snare(at: number, g = 1) {
    playNoise(this.a, this.bus!, { dur: 0.18, gain: 0.3 * g, type: 'bandpass', f0: 1800, q: 0.8, at });
    playTone(this.a, this.bus!, { freq: 190, to: 150, dur: 0.1, gain: 0.18 * g, type: 'triangle', at });
  }
  private hat(at: number, g: number) {
    playNoise(this.a, this.bus!, { dur: 0.04, gain: g, type: 'highpass', f0: 7500, at });
  }
  private bass(at: number, note: number, dur: number, g = 0.22) {
    playTone(this.a, this.bus!, { freq: midi(note), dur, gain: g, type: 'sawtooth', filter: 700, at });
  }
  private lead(at: number, note: number, dur: number, g = 0.07) {
    playTone(this.a, this.bus!, { freq: midi(note), dur, gain: g, type: 'square', filter: 2600, at });
  }
  private pad(at: number, notes: number[], dur: number, g = 0.035) {
    for (const n of notes) {
      for (const det of [-8, 8]) {
        playTone(this.a, this.bus!, { freq: midi(n), dur, gain: g, type: 'sawtooth', filter: 1000, at, attack: dur * 0.3, detune: det });
      }
    }
  }
  private pluck(at: number, note: number, g = 0.09) {
    playTone(this.a, this.bus!, { freq: midi(note), dur: 0.5, gain: g, type: 'triangle', at });
  }

  // ---------- Bản nhạc ----------
  private battleStep(step: number, at: number, sd: number) {
    const s = step % 16;
    const bar = Math.floor(step / 16) % 4;
    const section = Math.floor(step / 64) % 4; // 0 intro · 1 cao trào · 2 cao trào + lead cao · 3 lắng
    const chord = BATTLE.lead[bar];

    if (section !== 3) {
      if (s % 4 === 0) this.kick(at);
    } else if (s === 0 || s === 8) {
      this.kick(at, 0.7);
    }
    if ((section === 1 || section === 2) && (s === 4 || s === 12)) this.snare(at);
    if (section === 3 && bar === 3 && s >= 8 && s % 2 === 0) this.snare(at, 0.4 + (s - 8) * 0.08); // dồn trống chuyển đoạn
    if (s % 4 === 2) this.hat(at, 0.09);
    else if (section !== 0 && s % 2 === 1) this.hat(at, 0.035);

    const b = BATTLE.bassPattern[s];
    if (b !== null) this.bass(at, BATTLE.bass[bar] + b, sd * 1.6);

    if ((section === 1 || section === 2) && s % 2 === 0) {
      const note = chord[BATTLE.arp[s / 2]] + (section === 2 ? 12 : 0);
      this.lead(at, note, sd * 1.8, section === 2 ? 0.05 : 0.065);
    }
    if (section === 3 && s === 0) this.pad(at, chord.map((n) => n - 12), sd * 16);
  }

  private menuStep(step: number, at: number, sd: number) {
    const s = step % 16;
    const bar = Math.floor(step / 16) % 4;
    const chord = MENU.chords[bar];
    if (s === 0) {
      this.pad(at, chord, sd * 16, 0.028);
      playTone(this.a, this.bus!, { freq: midi(MENU.bass[bar]), dur: sd * 15, gain: 0.16, type: 'triangle', at, attack: 0.05 });
    }
    if (s % 2 === 0) this.pluck(at, chord[MENU.arp[s / 2]] + 12, s === 0 ? 0.1 : 0.07);
    if (s === 0 || s === 10) this.kick(at, 0.35);
    if (s === 4 || s === 12) this.hat(at, 0.04);
  }
}
