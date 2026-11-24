import { W } from './game/constants';
import type { GameEvent } from './game/world';
import type { WeaponId } from './game/weapons';
import type { PickupKind } from './game/pickups';

/**
 * Toàn bộ âm thanh được tổng hợp bằng WebAudio — không cần file âm thanh, không lo bản quyền.
 * Sơ đồ: [sfx]  ─┐
 *               ├─ master ─ compressor ─ loa
 *        [nhạc] ─┘
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  sfxBus!: GainNode;
  musicBus!: GainNode;
  noise!: AudioBuffer;
  sfxVolume = 0.5;
  musicVolume = 0.35;
  muted = false;
  private readyCallbacks: (() => void)[] = [];

  /** Phải gọi trong một thao tác của người dùng (click/phím) do chính sách autoplay của trình duyệt. */
  ensure(): AudioContext | null {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return null;
      }
      const ctx = this.ctx;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      comp.connect(ctx.destination);
      this.master = ctx.createGain();
      this.master.connect(comp);
      this.sfxBus = ctx.createGain();
      this.sfxBus.connect(this.master);
      this.musicBus = ctx.createGain();
      this.musicBus.connect(this.master);

      const len = ctx.sampleRate * 2;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

      this.applyVolumes();
      for (const f of this.readyCallbacks) f();
      this.readyCallbacks = [];
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  onReady(f: () => void) {
    if (this.ctx) f();
    else this.readyCallbacks.push(f);
  }

  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : 1, t, 0.03);
    this.sfxBus.gain.setTargetAtTime(this.sfxVolume, t, 0.03);
    this.musicBus.gain.setTargetAtTime(this.musicVolume * 0.7, t, 0.03);
  }
}

// ---------- Khối âm cơ bản (dùng chung cho hiệu ứng và nhạc) ----------
export interface NoiseOpts {
  dur: number; gain: number; type?: BiquadFilterType; f0: number; f1?: number; q?: number; at?: number;
}
export interface ToneOpts {
  freq: number; to?: number; dur: number; gain: number; type?: OscillatorType; at?: number; attack?: number;
  filter?: number; detune?: number;
}

export function playNoise(a: AudioEngine, out: AudioNode, o: NoiseOpts) {
  const ctx = a.ctx!;
  const t = ctx.currentTime + (o.at ?? 0);
  const src = ctx.createBufferSource();
  src.buffer = a.noise;
  const f = ctx.createBiquadFilter();
  f.type = o.type ?? 'lowpass';
  f.Q.value = o.q ?? 0.7;
  f.frequency.setValueAtTime(o.f0, t);
  if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(o.gain, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  src.connect(f).connect(g).connect(out);
  const maxOffset = Math.max(0, a.noise.duration - o.dur - 0.1);
  src.start(t, Math.random() * maxOffset, o.dur + 0.05);
}

export function playTone(a: AudioEngine, out: AudioNode, o: ToneOpts) {
  const ctx = a.ctx!;
  const t = ctx.currentTime + (o.at ?? 0);
  const osc = ctx.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.freq, t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + o.dur);
  if (o.detune) osc.detune.value = o.detune;
  const g = ctx.createGain();
  const atk = o.attack ?? 0.003;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(o.gain, t + atk);
  g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(atk + 0.01, o.dur));
  let node: AudioNode = osc;
  if (o.filter) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = o.filter;
    node = osc.connect(f);
  }
  node.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + o.dur + 0.05);
}

export const midi = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

// ---------- Hiệu ứng âm thanh ----------
interface GunSound { body: number; f0: number; f1: number; thump: [number, number]; thumpGain: number; gain: number; tail?: number }

const GUNS: Record<WeaponId, GunSound> = {
  pistol:  { body: 0.12, f0: 3500, f1: 700,  thump: [190, 60],  thumpGain: 0.5, gain: 0.5 },
  smg:     { body: 0.07, f0: 4200, f1: 1300, thump: [240, 90],  thumpGain: 0.3, gain: 0.32 },
  shotgun: { body: 0.32, f0: 2200, f1: 250,  thump: [130, 40],  thumpGain: 0.9, gain: 0.75 },
  rifle:   { body: 0.11, f0: 3000, f1: 800,  thump: [170, 55],  thumpGain: 0.55, gain: 0.48 },
  sniper:  { body: 0.45, f0: 3200, f1: 200,  thump: [110, 30],  thumpGain: 1, gain: 0.85, tail: 0.9 },
};

export class Sfx {
  constructor(private a: AudioEngine) {}

  /** Âm thanh lệch trái/phải theo vị trí trên bản đồ. */
  private out(x?: number): AudioNode {
    const ctx = this.a.ctx!;
    if (x === undefined) return this.a.sfxBus;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, (x / W) * 2 - 1)) * 0.7;
    p.connect(this.a.sfxBus);
    return p;
  }

  private noise(out: AudioNode, o: NoiseOpts) { playNoise(this.a, out, o); }
  private tone(out: AudioNode, o: ToneOpts) { playTone(this.a, out, o); }

  private arp(out: AudioNode, notes: number[], step: number, dur: number, gain: number, type: OscillatorType = 'triangle') {
    notes.forEach((n, i) => this.tone(out, { freq: midi(n), dur, gain, type, at: i * step }));
  }

  gunshot(id: WeaponId, x?: number) {
    if (!this.a.ctx) return;
    const g = GUNS[id];
    const out = this.out(x);
    const v = 1 + (Math.random() - 0.5) * 0.08; // lệch cao độ nhẹ để không bị lặp nhàm
    this.noise(out, { dur: 0.02, gain: g.gain * 0.6, type: 'highpass', f0: 5000 });                 // tiếng đanh
    this.noise(out, { dur: g.body, gain: g.gain, type: 'lowpass', f0: g.f0 * v, f1: g.f1 });         // tiếng nổ chính
    this.tone(out, { freq: g.thump[0] * v, to: g.thump[1], dur: 0.1, gain: g.gain * g.thumpGain });  // tiếng dội trầm
    if (g.tail) this.noise(out, { dur: g.tail, gain: 0.22, type: 'lowpass', f0: 900, f1: 120, at: 0.03 }); // vang
  }

  pickup(kind: PickupKind, x?: number) {
    if (!this.a.ctx) return;
    const out = this.out(x);
    switch (kind) {
      case 'health':
        this.arp(out, [72, 76, 79, 84], 0.06, 0.16, 0.2);
        break;
      case 'armor':
        this.tone(out, { freq: 880, dur: 0.35, gain: 0.14, type: 'triangle' });
        this.tone(out, { freq: 1320, dur: 0.3, gain: 0.1, type: 'triangle', at: 0.03 });
        this.tone(out, { freq: 1760, dur: 0.25, gain: 0.07, type: 'triangle', at: 0.06 });
        this.noise(out, { dur: 0.15, gain: 0.08, type: 'highpass', f0: 6000 });
        break;
      case 'damage':
        this.tone(out, { freq: 150, to: 600, dur: 0.28, gain: 0.16, type: 'sawtooth', filter: 2500 });
        this.tone(out, { freq: 300, to: 1200, dur: 0.22, gain: 0.07, type: 'square', filter: 3000 });
        this.noise(out, { dur: 0.22, gain: 0.14, type: 'bandpass', f0: 800, f1: 3500, q: 2 });
        break;
      case 'speed':
        this.noise(out, { dur: 0.28, gain: 0.25, type: 'bandpass', f0: 600, f1: 5000, q: 2 });
        this.arp(out, [79, 84, 88, 91], 0.04, 0.08, 0.07, 'square');
        break;
      case 'ammo':
        for (let i = 0; i < 3; i++) this.noise(out, { dur: 0.03, gain: 0.3, type: 'bandpass', f0: 2500, q: 8, at: i * 0.07 });
        this.tone(out, { freq: 1000, dur: 0.06, gain: 0.08, type: 'square', at: 0.22 });
        break;
    }
  }

  upgrade() {
    if (!this.a.ensure()) return;
    const out = this.out();
    this.noise(out, { dur: 0.05, gain: 0.3, type: 'bandpass', f0: 2500, q: 6 });
    this.arp(out, [67, 72, 76, 79, 84], 0.07, 0.25, 0.16);
    this.tone(out, { freq: midi(96), dur: 0.5, gain: 0.05, type: 'sine', at: 0.35 });
  }

  click() {
    if (!this.a.ensure()) return;
    this.tone(this.out(), { freq: 900, dur: 0.04, gain: 0.06, type: 'triangle' });
  }

  onEvents(events: GameEvent[]) {
    if (!this.a.ctx || this.a.ctx.state !== 'running') return;
    const hitOnce = new Set<string>(); // shotgun trúng nhiều viên cùng lúc → chỉ phát 1 tiếng
    for (const e of events) {
      switch (e.type) {
        case 'shoot':
          this.gunshot(e.weapon, e.x);
          break;
        case 'hit': {
          const key = `${e.target}${e.armor}`;
          if (hitOnce.has(key)) break;
          hitOnce.add(key);
          const out = this.out(e.x);
          if (e.armor) {
            this.tone(out, { freq: 2200, dur: 0.12, gain: 0.12, type: 'triangle' });
            this.tone(out, { freq: 3300, dur: 0.08, gain: 0.07, type: 'triangle' });
          } else {
            this.tone(out, { freq: 1400, to: 600, dur: 0.06, gain: 0.14, type: 'square', filter: 3000 });
            this.noise(out, { dur: 0.05, gain: 0.2, type: 'bandpass', f0: 1500, q: 1.5 });
          }
          break;
        }
        case 'kill': {
          const out = this.out(e.x);
          this.tone(out, { freq: 160, to: 40, dur: 0.5, gain: 0.6 });
          this.noise(out, { dur: 0.45, gain: 0.35, type: 'lowpass', f0: 1500, f1: 100 });
          this.tone(out, { freq: 440, to: 110, dur: 0.4, gain: 0.08, type: 'sawtooth', filter: 2000 });
          break;
        }
        case 'spark':
          break; // đạn chạm tường: im lặng cho đỡ ồn
        case 'reload': {
          const out = this.out();
          this.noise(out, { dur: 0.03, gain: 0.25, type: 'bandpass', f0: 2500, q: 8 });
          this.noise(out, { dur: 0.04, gain: 0.2, type: 'bandpass', f0: 1600, q: 6, at: 0.12 });
          break;
        }
        case 'reloadDone': {
          const out = this.out();
          this.noise(out, { dur: 0.035, gain: 0.32, type: 'bandpass', f0: 3000, q: 6 });
          this.tone(out, { freq: 900, dur: 0.03, gain: 0.08, type: 'square', at: 0.05 });
          break;
        }
        case 'switch':
          this.noise(this.out(), { dur: 0.025, gain: 0.22, type: 'bandpass', f0: 2000, q: 5 });
          this.tone(this.out(), { freq: 600, dur: 0.04, gain: 0.06, type: 'triangle', at: 0.03 });
          break;
        case 'dash':
          this.noise(this.out(e.x), { dur: 0.22, gain: 0.32, type: 'bandpass', f0: 400, f1: 2600, q: 1.5 });
          break;
        case 'pickupSpawn':
          this.tone(this.out(e.x), { freq: midi(91), dur: 0.25, gain: 0.05 });
          this.tone(this.out(e.x), { freq: midi(96), dur: 0.25, gain: 0.035, at: 0.06 });
          break;
        case 'pickup':
          this.pickup(e.kind, e.x);
          break;
        case 'countdown':
          this.tone(this.out(), { freq: 660, dur: 0.15, gain: 0.22, type: 'triangle' });
          break;
        case 'go':
          for (const n of [69, 73, 76]) this.tone(this.out(), { freq: midi(n), dur: 0.45, gain: 0.12, type: 'sawtooth', filter: 2500 });
          break;
        case 'roundEnd':
          if (e.winner === null) this.arp(this.out(), [67, 65], 0.12, 0.25, 0.14);
          else this.arp(this.out(), [67, 71, 74], 0.08, 0.3, 0.15);
          break;
        case 'matchEnd':
          break; // nhạc kết thúc do Music phát
      }
    }
  }
}
