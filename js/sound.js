// 効果音（音声ファイルを使わず、その場で作る）
(function (root) {
  'use strict';
  const H = root.Hitogomi = root.Hitogomi || {};
  let ac = null;

  function audio() {
    if (!ac) {
      try { ac = new (root.AudioContext || root.webkitAudioContext)(); } catch (e) { return null; }
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }

  function tone(freq, start, dur, type, vol, toFreq) {
    const a = audio();
    if (!a) return;
    const t = a.currentTime + start;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (toFreq) o.frequency.exponentialRampToValueAtTime(toFreq, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.15, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  H.sound = {
    unlock() { audio(); },
    tick() { tone(880, 0, 0.08, 'square', 0.05); },
    start() { tone(523, 0, 0.12, 'square', 0.08); tone(784, 0.12, 0.25, 'square', 0.08); },
    star() { tone(988, 0, 0.08, 'triangle', 0.12); tone(1319, 0.07, 0.18, 'triangle', 0.12); },
    whiff() { tone(300, 0, 0.12, 'sine', 0.06, 180); },
    miss() { tone(392, 0, 0.18, 'sawtooth', 0.07, 300); tone(262, 0.16, 0.3, 'sawtooth', 0.07, 200); },
    caught() { tone(660, 0, 0.1, 'square', 0.1); tone(880, 0.1, 0.1, 'square', 0.1); tone(1175, 0.2, 0.3, 'square', 0.1); },
    end() { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.13, 0.3, 'triangle', 0.12)); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
