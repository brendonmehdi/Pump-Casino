/**
 * Every sound is synthesised with the Web Audio API (no recorded or third-party assets).
 * Pump hisses brighter as risk rises, a cash-out rings two clear notes, the top of the ladder
 * gets a short rising arpeggio, and a pop is a deliberately quiet, low thud.
 */
export type SoundCue = 'pump' | 'cashout' | 'pop' | 'top';

type AudioContextConstructor = new () => AudioContext;

/** Web Audio is optional: some browsers lack it, or only offer the webkit-prefixed version. */
type AudioScope = Omit<Window, 'AudioContext'> & {
  readonly AudioContext?: AudioContextConstructor;
  readonly webkitAudioContext?: AudioContextConstructor;
};

function findAudioContext(): AudioContextConstructor | null {
  const scope: AudioScope = window;
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

export class SoundEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private volume = 0.6;
  private muted = false;
  /** False when this browser has no usable Web Audio; the game then simply plays silently. */
  readonly supported = findAudioContext() !== null;

  /**
   * Browsers only allow audio after a user gesture, so this runs from click/key handlers. It
   * must never throw: a missing or failing audio stack cannot be allowed to block a bet.
   */
  unlock(): void {
    if (!this.context) {
      const AudioContextClass = findAudioContext();
      if (!AudioContextClass) return;
      let context: AudioContext;
      try {
        context = new AudioContextClass();
      } catch {
        return; // e.g. the browser's limit on audio contexts: play on without sound
      }
      const master = context.createGain();
      master.connect(context.destination);
      this.context = context;
      this.master = master;
      this.noise = createNoise(context);
      this.applyGain();
    }
    if (this.context.state === 'suspended') void this.context.resume();
  }

  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume));
    this.applyGain();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyGain();
  }

  /** `intensity` runs 0 → 1 with the pump count, raising the pitch of the hiss. */
  play(cue: SoundCue, intensity = 0): void {
    const { context, master, noise } = this;
    if (!context || !master || !noise || this.muted || context.state !== 'running') return;
    const at = context.currentTime + 0.005;
    switch (cue) {
      case 'pump':
        this.hiss(at, 0.13, 900 + 2400 * intensity, 0.22);
        this.tone(at, 0.12, 180 + 260 * intensity, 260 + 520 * intensity, 'sine', 0.07);
        break;
      case 'cashout':
        this.tone(at, 0.16, 1318.5, 1318.5, 'triangle', 0.16);
        this.tone(at + 0.085, 0.3, 1975.5, 1975.5, 'triangle', 0.14);
        this.hiss(at, 0.08, 6000, 0.05);
        break;
      case 'top':
        [1046.5, 1318.5, 1568, 2093].forEach((frequency, index) => {
          this.tone(at + index * 0.075, 0.28, frequency, frequency, 'triangle', 0.13);
        });
        break;
      case 'pop':
        this.hiss(at, 0.09, 700, 0.12);
        this.tone(at, 0.18, 110, 55, 'sine', 0.16);
        break;
    }
  }

  private applyGain(): void {
    if (!this.master || !this.context) return;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.context.currentTime, 0.01);
  }

  private tone(
    at: number,
    duration: number,
    from: number,
    to: number,
    type: OscillatorType,
    peak: number,
  ): void {
    const { context, master } = this;
    if (!context || !master) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, at);
    oscillator.frequency.exponentialRampToValueAtTime(to, at + duration);
    envelope(gain, at, duration, peak);
    oscillator.connect(gain).connect(master);
    oscillator.start(at);
    oscillator.stop(at + duration + 0.02);
  }

  private hiss(at: number, duration: number, frequency: number, peak: number): void {
    const { context, master, noise } = this;
    if (!context || !master || !noise) return;
    const source = context.createBufferSource();
    source.buffer = noise;
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(frequency, at);
    filter.Q.value = 0.9;
    const gain = context.createGain();
    envelope(gain, at, duration, peak);
    source.connect(filter).connect(gain).connect(master);
    source.start(at);
    source.stop(at + duration + 0.02);
  }
}

function envelope(gain: GainNode, at: number, duration: number, peak: number): void {
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
}

function createNoise(context: AudioContext): AudioBuffer {
  const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
  return buffer;
}
