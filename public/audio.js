// Web Audio API Procedural Synthesizer untuk Efek Suara Ular Tangga 3D
class SoundFX {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  ensureContext() {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  setEnabled(val) {
    this.enabled = Boolean(val);
    return this.enabled;
  }

  tone(freq, duration, type = 'sine', gainVal = 0.14, delay = 0, slideTo = null) {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (slideTo) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), now + duration);
    }

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(gainVal, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  playDiceRoll() {
    // Suara kocok & pantulan dadu bertahap melambat
    const offsets = [0, 0.09, 0.19, 0.31, 0.46, 0.64, 0.85];
    offsets.forEach((t, i) => {
      const freq = 280 + (i % 3) * 90 - i * 15;
      this.tone(freq, 0.06, 'triangle', Math.max(0.05, 0.16 - i * 0.015), t, freq * 0.65);
    });
  }

  playHop(index = 0) {
    const base = 360 + (index % 8) * 35;
    this.tone(base, 0.11, 'sine', 0.13, 0, base * 1.25);
  }

  playBounceBack() {
    this.tone(320, 0.14, 'triangle', 0.14, 0, 180);
  }

  playLadderClimb() {
    const notes = [392, 493.88, 587.33, 659.25, 783.99, 987.77];
    notes.forEach((n, idx) => {
      this.tone(n, 0.16, 'triangle', 0.13, idx * 0.11);
    });
  }

  playSnakeSlide() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    // Slide turun dramatis + nada kartun
    this.tone(680, 0.95, 'sawtooth', 0.08, 0, 110);
    this.tone(520, 0.85, 'sine', 0.12, 0.05, 130);
  }

  playMystery() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((n, idx) => {
      this.tone(n, 0.22, 'sine', 0.12, idx * 0.07);
    });
  }

  playShieldSave() {
    this.tone(440, 0.12, 'square', 0.08, 0, 660);
    this.tone(880, 0.32, 'triangle', 0.14, 0.09);
  }

  playTurnBell() {
    this.tone(587.33, 0.14, 'sine', 0.09, 0);
    this.tone(880, 0.2, 'sine', 0.09, 0.08);
  }

  playEmote() {
    this.tone(520, 0.08, 'sine', 0.09, 0, 780);
  }

  playWinFanfare() {
    const melody = [
      { f: 523.25, d: 0.14, t: 0 },
      { f: 659.25, d: 0.14, t: 0.13 },
      { f: 783.99, d: 0.14, t: 0.26 },
      { f: 1046.5, d: 0.45, t: 0.4 },
      { f: 783.99, d: 0.14, t: 0.58 },
      { f: 1046.5, d: 0.6, t: 0.72 }
    ];
    melody.forEach((m) => {
      this.tone(m.f, m.d, 'triangle', 0.16, m.t);
    });
  }
}

export const soundFX = new SoundFX();
