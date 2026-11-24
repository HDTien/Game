import type { GameEvent } from './game/world';

/** Hiệu ứng âm thanh tổng hợp bằng WebAudio — không cần file âm thanh. */
export class Sfx {
  private ctx: AudioContext | null = null;
  private noiseBuf: AudioBuffer | null = null;
  volume = 0.5;

  /** Phải gọi trong một thao tác của người dùng (click) do chính sách autoplay. */
  ensure() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private noise(dur: number, freq: number, gain: number) {
    const ctx = this.ctx;
    if (!ctx || !this.noiseBuf || this.volume <= 0) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = freq;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(gain * this.volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(g).connect(ctx.destination);
    src.start(t, Math.random() * 0.5, dur);
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', slideTo?: number) {
    const ctx = this.ctx;
    if (!ctx || this.volume <= 0) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    const t = ctx.currentTime;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain * this.volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur);
  }

  onEvents(events: GameEvent[]) {
    for (const e of events) {
      switch (e.type) {
        case 'shoot':
          if (e.weapon === 'pistol') this.noise(0.09, 2600, 0.25);
          else if (e.weapon === 'smg') this.noise(0.05, 3200, 0.16);
          else this.noise(0.2, 1300, 0.4);
          break;
        case 'hit': this.tone(900, 0.05, 0.12, 'square'); break;
        case 'kill': this.tone(260, 0.4, 0.25, 'sawtooth', 60); break;
        case 'reload': this.tone(420, 0.05, 0.08, 'square'); break;
        case 'reloadDone': this.tone(720, 0.06, 0.08, 'square'); break;
        case 'switch': this.tone(560, 0.03, 0.06, 'triangle'); break;
        case 'dash': this.noise(0.15, 700, 0.15); break;
        case 'countdown': this.tone(520, 0.12, 0.18, 'triangle'); break;
        case 'go': this.tone(880, 0.25, 0.22, 'triangle'); break;
        case 'roundEnd': this.tone(660, 0.3, 0.18, 'triangle', 990); break;
        case 'matchEnd': this.tone(523, 0.6, 0.2, 'triangle', 1046); break;
      }
    }
  }
}
