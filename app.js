/* ============================================================
   PROJET VINYLE — app.js
   Le DISQUE tourne. Le capteur est fixe en haut.
   Une bille sonne quand elle passe sous le capteur.
   ============================================================ */

/* ============================================================
   CONVENTION ANGULAIRE (partout dans ce fichier)
   angle 0 = haut (12h), sens horaire, en radians.
   polar(cx, cy, r, angle) : utilise sin/cos pour cette convention.
   ============================================================ */

var DISC_COLORS = {
  bg:         '#faf8f4',
  ring:       '#ddd8d0',
  tick:       '#b8b2a8',
  tickHover:  '#aaa59d',
  sensor:     '#1a1815',
  sensorFire: '#1a1815',
  hub:        '#3a3530',
  beat:       '#3a3530',
  beatFire:   '#1a1815',
  outer:      '#aaa59d',
};

var TRACKS = [
  { radius: 52,  subdivisions: 8,  beats: [] },
  { radius: 86,  subdivisions: 12, beats: [] },
  { radius: 120, subdivisions: 16, beats: [] },
  { radius: 154, subdivisions: 24, beats: [] },
];

var HIT_RADIUS   = 18;
var BEAT_MERGE   = 0.15;
var BEAT_RADIUS  = 5;
var BEAT_FIRE_R  = 7.5;
var PULSE_DECAY  = 0.18;
var SENSOR_DECAY = 0.12;

var discCanvas  = null;
var discCtx     = null;
var DPR         = 1;
var CX = 0, CY  = 0;
var SCALE       = 1;  // facteur d'échelle : 1 = canvas 360px (design de référence)
var discBpm     = 90;
var phase       = 0;      // 0..1 : rotation du disque
var lastTs      = null;
var rafId       = null;
var discRunning = false;
var pulses      = [];     // {ti, bi, t} — flash d'une bille
var sensorPulse = 0;      // durée restante du flash capteur

var audioCtx  = null;
var soundOn   = false;
var soundType = 'bille'; // 'bille' | 'synth'

/* ============================================================
   INIT
   ============================================================ */

function initDisc(canvas) {
  discCanvas = canvas;
  setupCanvas();
  discCanvas.addEventListener('click', onCanvasClick);
  discCanvas.addEventListener('touchend', onCanvasTouchEnd, { passive: false });
  window.addEventListener('resize', function () { setupCanvas(); discDraw(); });
  discDraw(); // dessiner le disque vide dès l'init
}

function setupCanvas() {
  DPR = window.devicePixelRatio || 1;
  var cssW = discCanvas.parentElement.offsetWidth || 360;
  discCanvas.style.width  = cssW + 'px';
  discCanvas.style.height = cssW + 'px';
  discCanvas.width  = Math.round(cssW * DPR);
  discCanvas.height = Math.round(cssW * DPR);
  discCtx = discCanvas.getContext('2d');
  discCtx.scale(DPR, DPR);
  CX    = cssW / 2;
  CY    = cssW / 2;
  SCALE = CX / 196; // 196 > 188 (rayon max capteur) — garantit que rien ne sort du canvas
}

/* ============================================================
   ANIMATION
   ============================================================ */

function startDisc() {
  if (discRunning) return;
  discRunning = true;
  lastTs = null;
  rafId = requestAnimationFrame(discTick);
}

function stopDisc() {
  discRunning = false;
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
}

function discTick(ts) {
  if (!discRunning) return;
  if (!lastTs) lastTs = ts;
  var elapsed     = (ts - lastTs) / 1000;
  lastTs = ts;

  var barDuration = (4 / discBpm) * 60;
  var delta       = elapsed / barDuration;
  var prevPhase   = phase;
  phase = (phase + delta) % 1.0;

  checkBeats(prevPhase, phase, elapsed);
  updatePulses(elapsed);
  discDraw();

  rafId = requestAnimationFrame(discTick);
}

/* ============================================================
   DÉTECTION DE BEATS
   Une bille au repos à l'angle `a` passe sous le capteur (haut)
   quand : discPhase = (1 - a / 2π) mod 1
   ============================================================ */

function beatPhase(restAngle) {
  var p = 1 - restAngle / (2 * Math.PI);
  return ((p % 1) + 1) % 1;
}

function checkBeats(prev, curr) {
  for (var ti = 0; ti < TRACKS.length; ti++) {
    var track = TRACKS[ti];
    for (var bi = 0; bi < track.beats.length; bi++) {
      var bp = beatPhase(track.beats[bi]);
      if (phaseCrossed(prev, curr, bp)) {
        pulses.push({ ti: ti, bi: bi, t: PULSE_DECAY });
        sensorPulse = SENSOR_DECAY;
        if (soundOn && audioCtx) triggerSound(ti);
      }
    }
  }
}

function phaseCrossed(prev, curr, target) {
  if (prev < curr) {
    return target > prev && target <= curr;
  } else {
    return target > prev || target <= curr;
  }
}

function updatePulses(elapsed) {
  for (var i = pulses.length - 1; i >= 0; i--) {
    pulses[i].t -= elapsed;
    if (pulses[i].t <= 0) pulses.splice(i, 1);
  }
  if (sensorPulse > 0) sensorPulse -= elapsed;
}

/* ============================================================
   DESSIN
   ============================================================ */

function discDraw() {
  var w = discCanvas.width  / DPR;
  var h = discCanvas.height / DPR;

  discCtx.clearRect(0, 0, w, h);
  discCtx.fillStyle = DISC_COLORS.bg;
  discCtx.fillRect(0, 0, w, h);

  // Rotation courante du disque en radians
  var discAngle = phase * 2 * Math.PI;

  // Anneau extérieur décoratif (fixe)
  drawRing(CX, CY, 172 * SCALE, DISC_COLORS.outer, 0.8);

  // Pistes (les anneaux ne bougent pas, étant des cercles)
  for (var ti = 0; ti < TRACKS.length; ti++) {
    var track = TRACKS[ti];
    var tr = track.radius * SCALE;

    drawRing(CX, CY, tr, DISC_COLORS.ring, 1);

    // Tirets de subdivision (tournent avec le disque)
    for (var s = 0; s < track.subdivisions; s++) {
      var a = (s / track.subdivisions) * 2 * Math.PI + discAngle;
      var p1 = polar(CX, CY, tr - 4 * SCALE, a);
      var p2 = polar(CX, CY, tr + 4 * SCALE, a);
      drawLine(p1, p2, DISC_COLORS.tick, 0.7);
    }

    // Billes (tournent avec le disque)
    for (var bi = 0; bi < track.beats.length; bi++) {
      var pulse = null;
      for (var pi = 0; pi < pulses.length; pi++) {
        if (pulses[pi].ti === ti && pulses[pi].bi === bi) { pulse = pulses[pi]; break; }
      }
      // Position screen = position repos + rotation disque
      var screenAngle = track.beats[bi] + discAngle;
      var pos = polar(CX, CY, tr, screenAngle);
      var r   = pulse ? BEAT_FIRE_R * SCALE * (0.6 + 0.4 * (pulse.t / PULSE_DECAY)) : BEAT_RADIUS * SCALE;
      var col = pulse ? DISC_COLORS.beatFire : DISC_COLORS.beat;
      drawDisc(pos.x, pos.y, r, col);
    }
  }

  // Centre
  drawDisc(CX, CY, 4 * SCALE, DISC_COLORS.hub);

  // Capteur fixe (en haut, angle = 0)
  drawSensor();
}

function drawSensor() {
  var firing  = sensorPulse > 0;
  var color   = firing ? DISC_COLORS.sensorFire : DISC_COLORS.outer;
  var lw      = firing ? 2 : 1;

  // Tige du capteur : de l'extérieur vers l'intérieur, en haut
  var tip   = polar(CX, CY, 165 * SCALE, 0);
  var outer = polar(CX, CY, 188 * SCALE, 0);
  discCtx.beginPath();
  discCtx.moveTo(outer.x, outer.y);
  discCtx.lineTo(tip.x, tip.y);
  discCtx.strokeStyle = color;
  discCtx.lineWidth   = lw;
  discCtx.stroke();

  // Petite tête du capteur (triangle vers le bas)
  var a = 4 * SCALE;  // demi-largeur scalée
  var tipPt = polar(CX, CY, 163 * SCALE, 0);
  var la    = polar(CX, CY, 172 * SCALE, 0);
  var lx    = la.x - a;
  var rx    = la.x + a;
  discCtx.beginPath();
  discCtx.moveTo(tipPt.x, tipPt.y);
  discCtx.lineTo(lx, la.y);
  discCtx.lineTo(rx, la.y);
  discCtx.closePath();
  discCtx.fillStyle = color;
  discCtx.fill();
}

/* ============================================================
   INTERACTION — CLIC / TOUCH
   ============================================================ */

function onCanvasClick(e) {
  handlePointer(e.clientX, e.clientY);
}

function onCanvasTouchEnd(e) {
  e.preventDefault();
  var t = e.changedTouches[0];
  handlePointer(t.clientX, t.clientY);
}

function handlePointer(clientX, clientY) {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (ex) {}
  }

  var rect = discCanvas.getBoundingClientRect();
  var cssX = clientX - rect.left;
  var cssY = clientY - rect.top;
  var dx   = cssX - CX;
  var dy   = cssY - CY;
  var dist = Math.sqrt(dx * dx + dy * dy);

  // Identifier la piste la plus proche
  var bestTrack = -1;
  var bestDelta = Infinity;
  for (var ti = 0; ti < TRACKS.length; ti++) {
    var d = Math.abs(dist - TRACKS[ti].radius * SCALE);
    if (d < HIT_RADIUS * SCALE && d < bestDelta) {
      bestDelta = d;
      bestTrack = ti;
    }
  }
  if (bestTrack === -1) return;

  // Angle screen du clic (convention : 0=haut, sens horaire)
  var screenAngle = Math.atan2(dx, -dy); // atan2(x, -y) donne 0=haut, horaire
  if (screenAngle < 0) screenAngle += 2 * Math.PI;

  // Angle au repos sur le disque = angle screen - rotation disque
  var discAngle = phase * 2 * Math.PI;
  var restAngle = ((screenAngle - discAngle) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);

  var track = TRACKS[bestTrack];

  // Retirer une bille existante si le clic est proche (en angles repos)
  for (var bi = 0; bi < track.beats.length; bi++) {
    var diff = Math.abs(track.beats[bi] - restAngle);
    if (diff > Math.PI) diff = 2 * Math.PI - diff;
    if (diff < BEAT_MERGE) {
      track.beats.splice(bi, 1);
      pulses = pulses.filter(function (p) { return !(p.ti === bestTrack && p.bi === bi); });
      for (var pi = 0; pi < pulses.length; pi++) {
        if (pulses[pi].ti === bestTrack && pulses[pi].bi > bi) pulses[pi].bi--;
      }
      if (!discRunning) discDraw();
      return;
    }
  }

  // Ajouter la bille
  track.beats.push(restAngle);
  if (!discRunning) discDraw();
}

/* ============================================================
   UTILITAIRE — polar
   angle 0 = haut (12h), sens horaire
   ============================================================ */
function polar(cx, cy, r, angle) {
  return {
    x: cx + r * Math.sin(angle),
    y: cy - r * Math.cos(angle),
  };
}

/* ============================================================
   CONTRÔLES
   ============================================================ */

function discSetBpm(value)    { discBpm = value; }

function discReset() {
  for (var i = 0; i < TRACKS.length; i++) TRACKS[i].beats = [];
  pulses = [];
  sensorPulse = 0;
  if (!discRunning) discDraw();
}

function discBjorklund() {
  for (var i = 0; i < TRACKS.length; i++) {
    var n = TRACKS[i].beats.length;
    if (n < 2) continue;
    TRACKS[i].beats = [];
    for (var j = 0; j < n; j++) {
      TRACKS[i].beats.push((j / n) * 2 * Math.PI);
    }
  }
  pulses = [];
  if (!discRunning) discDraw();
}

function discToggleSound(on) {
  soundOn = on;
  if (on && !audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (ex) {}
  }
}

/* ============================================================
   SON — Web Audio API
   ============================================================ */

function triggerSound(trackIdx) {
  if (!audioCtx) return;
  if (soundType === 'synth') triggerSynth(trackIdx);
  else                       triggerBille(trackIdx);
}

// BILLE : cristallin — bref transient + sonnerie sinus harmonique (verre / triangle)
function triggerBille(trackIdx) {
  var now = audioCtx.currentTime;

  // Fondamentales : A4 C5 E5 A5 (aigu = cristallin)
  var pitchFreqs = [880, 1046.50, 1318.51, 1760]; // A5 C6 E6 A6
  var freq = pitchFreqs[trackIdx] || 440;

  // Clic d'attaque : sinus très court à 5× freq (transient pur, pas de bruit)
  var cOsc  = audioCtx.createOscillator();
  var cGain = audioCtx.createGain();
  cOsc.type = 'sine';
  cOsc.frequency.value = freq * 5;
  cGain.gain.setValueAtTime(0.22, now);
  cGain.gain.exponentialRampToValueAtTime(0.001, now + 0.005);
  cOsc.connect(cGain); cGain.connect(audioCtx.destination);
  cOsc.start(now); cOsc.stop(now + 0.006);

  // Fondamentale
  var osc1  = audioCtx.createOscillator();
  var g1    = audioCtx.createGain();
  osc1.type = 'sine';
  osc1.frequency.value = freq;
  g1.gain.setValueAtTime(0.16, now);
  g1.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
  osc1.connect(g1); g1.connect(audioCtx.destination);
  osc1.start(now); osc1.stop(now + 0.10);

  // Légère détune (shimmer métallique)
  var osc2  = audioCtx.createOscillator();
  var g2    = audioCtx.createGain();
  osc2.type = 'sine';
  osc2.frequency.value = freq * 1.004;
  g2.gain.setValueAtTime(0.10, now);
  g2.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
  osc2.connect(g2); g2.connect(audioCtx.destination);
  osc2.start(now); osc2.stop(now + 0.08);

  // Partielle inharmonique (×2.756 — ratio métal/cloche)
  var osc3  = audioCtx.createOscillator();
  var g3    = audioCtx.createGain();
  osc3.type = 'sine';
  osc3.frequency.value = freq * 2.756;
  g3.gain.setValueAtTime(0.055, now);
  g3.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
  osc3.connect(g3); g3.connect(audioCtx.destination);
  osc3.start(now); osc3.stop(now + 0.05);
}

// SYNTHÉ ANALOGIQUE : deux oscillateurs dent-de-scie désyntonisés
// + filtre passe-bas résonant avec enveloppe (Moog-like)
function triggerSynth(trackIdx) {
  var now       = audioCtx.currentTime;
  // Gamme pentatonique mineure : A2 C3 E3 A3
  var baseFreqs = [110, 130.81, 164.81, 220];
  var freq      = baseFreqs[trackIdx] || 110;

  // Deux oscillateurs légèrement désyntonisés (chorus analogique)
  var osc1 = audioCtx.createOscillator();
  var osc2 = audioCtx.createOscillator();
  osc1.type = 'sawtooth';
  osc2.type = 'sawtooth';
  osc1.frequency.value = freq;
  osc2.frequency.value = freq * 1.009; // détune ~15 cents

  // Filtre passe-bas résonant
  var filter = audioCtx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 9; // résonance prononcée
  // Enveloppe de filtre : s'ouvre vite, se referme lentement
  filter.frequency.setValueAtTime(60, now);
  filter.frequency.exponentialRampToValueAtTime(freq * 12, now + 0.025);
  filter.frequency.exponentialRampToValueAtTime(freq * 2,  now + 0.4);

  // Enveloppe d'amplitude
  var gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.10, now + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

  osc1.connect(filter);
  osc2.connect(filter);
  filter.connect(gain);
  gain.connect(audioCtx.destination);
  osc1.start(now); osc1.stop(now + 0.5);
  osc2.start(now); osc2.stop(now + 0.5);
}

function discSetSoundType(type) {
  soundType = type;
}

/* ============================================================
   UTILITAIRES DE DESSIN
   ============================================================ */

function drawRing(cx, cy, r, color, lw) {
  discCtx.beginPath();
  discCtx.arc(cx, cy, r, 0, 2 * Math.PI);
  discCtx.strokeStyle = color;
  discCtx.lineWidth   = lw;
  discCtx.stroke();
}

function drawLine(p1, p2, color, lw) {
  discCtx.beginPath();
  discCtx.moveTo(p1.x, p1.y);
  discCtx.lineTo(p2.x, p2.y);
  discCtx.strokeStyle = color;
  discCtx.lineWidth   = lw;
  discCtx.stroke();
}

function drawDisc(x, y, r, color) {
  discCtx.beginPath();
  discCtx.arc(x, y, r, 0, 2 * Math.PI);
  discCtx.fillStyle = color;
  discCtx.fill();
}

/* ============================================================
   NAVIGATION SPA
   ============================================================ */

var SECTIONS       = ['cover', 'performance', 'bio', 'technique'];
var currentSection = null;
var discActive     = false;

document.addEventListener('DOMContentLoaded', function () {
  var canvas = document.getElementById('disc-canvas');
  if (canvas) initDisc(canvas);

  wireDiscControls();

  document.querySelectorAll('[data-section]').forEach(function (link) {
    link.addEventListener('click', function (e) {
      e.preventDefault();
      showSection(link.dataset.section, true);
    });
  });

  var hash    = location.hash.slice(1);
  var initial = SECTIONS.indexOf(hash) !== -1 ? hash : 'cover';
  showSection(initial, false);

  window.addEventListener('popstate', function () {
    var h = location.hash.slice(1);
    if (SECTIONS.indexOf(h) !== -1) showSection(h, false);
  });
});

function showSection(id, pushState) {
  if (id === currentSection) return;

  if (currentSection === 'cover') pauseDisc();

  if (currentSection) {
    var prev = document.getElementById(currentSection);
    if (prev) {
      prev.classList.remove('fade-in');
      (function (el) {
        setTimeout(function () { el.classList.remove('visible'); }, 200);
      })(prev);
    }
  }

  var delay  = currentSection ? 200 : 0;
  var nextId = id;

  setTimeout(function () {
    var next = document.getElementById(nextId);
    if (next) {
      next.classList.add('visible');
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { next.classList.add('fade-in'); });
      });
    }

    document.querySelectorAll('[data-section]').forEach(function (link) {
      link.classList.toggle('active', link.dataset.section === nextId);
    });

    if (nextId === 'cover') resumeDisc();

    window.scrollTo({ top: 0, behavior: 'instant' });
  }, delay);

  currentSection = id;
  if (pushState) history.pushState(null, '', '#' + id);
}

function wireDiscControls() {
  var bpmSlider  = document.getElementById('bpm');
  var bpmDisplay = document.getElementById('bpm-display');
  if (bpmSlider) {
    bpmSlider.addEventListener('input', function () {
      discSetBpm(Number(bpmSlider.value));
      if (bpmDisplay) bpmDisplay.textContent = bpmSlider.value;
    });
  }

  var btnB = document.getElementById('btn-bjorklund');
  if (btnB) btnB.addEventListener('click', discBjorklund);

  var btnR = document.getElementById('btn-reset');
  if (btnR) btnR.addEventListener('click', discReset);

  var btnS = document.getElementById('btn-sound');
  if (btnS) {
    btnS.addEventListener('click', function () {
      var on = btnS.dataset.active !== 'true';
      btnS.dataset.active = on;
      btnS.textContent    = on ? 'SON ON' : 'SON OFF';
      btnS.classList.toggle('active', on);
      discToggleSound(on);
    });
  }

  // Sélecteur MEMBRANE / BILLE / BATTERIE
  var soundTypeBtns = [
    document.getElementById('btn-membrane'),
    document.getElementById('btn-bille'),
    document.getElementById('btn-synth'),
  ].filter(Boolean);

  soundTypeBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      soundTypeBtns.forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      discSetSoundType(btn.dataset.type);
    });
  });
}

function resumeDisc() {
  if (!discActive) {
    discActive = true;
    setTimeout(function () { setupCanvas(); startDisc(); }, 50);
  }
}

function pauseDisc() {
  if (discActive) {
    discActive = false;
    stopDisc();
  }
}
