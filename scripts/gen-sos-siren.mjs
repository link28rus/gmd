#!/usr/bin/env node
// Генератор SOS-сирены для mobile-parent — отдельный звук от signal_alarm.wav
// (тот используется на mobile-child для «Найди телефон»). Здесь — классический
// «полицейский wail»: плавный sweep между низким и высоким тоном, ~1.5 сек на
// цикл, 8 циклов = 12 секунд.
//
// Параметры подобраны под notification-сценарий, не SOS-будильник:
//   • Синус (не square) — менее raspy, более «полицейский», менее раздражает
//     других людей рядом, но безошибочно ассоциируется с тревогой.
//   • Sweep 600 → 1300 Hz и обратно за 1.5 сек — характерная wail-кривая,
//     mid-range частоты не так пронзительно как 2500/3500 Hz alarm, но
//     именно поэтому распознаётся как «полиция / скорая», не как будильник.
//   • Амплитуда 0.85 от full-scale, fade-in/out 8 мс — без «pop».
//
// Запуск:
//   node scripts/gen-sos-siren.mjs
// Артефакт:
//   apps/mobile-parent/android/app/src/main/res/raw/sos_siren.wav

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(
  __dirname,
  '..',
  'apps',
  'mobile-parent',
  'android',
  'app',
  'src',
  'main',
  'res',
  'raw',
  'sos_siren.wav',
);

const SR = 44100;
const AMP = 0.85;
const F_LOW = 600; // Hz
const F_HIGH = 1300; // Hz
const SWEEP_MS = 750; // up или down — итого один полный цикл 1500 мс
const CYCLES = 8;
const FADE_MS = 8;

const samplesPerSweep = Math.floor((SR * SWEEP_MS) / 1000);
const totalSamples = samplesPerSweep * 2 * CYCLES;
const fadeSamples = Math.floor((SR * FADE_MS) / 1000);

const pcm = new Int16Array(totalSamples);

// Phase-continuous sweep: интегрируем мгновенную частоту по времени.
let phase = 0;
let idx = 0;
for (let c = 0; c < CYCLES; c++) {
  // up-sweep
  for (let i = 0; i < samplesPerSweep; i++) {
    const t = i / samplesPerSweep;
    // косинус-easing — sweep ускоряется к середине, плавнее звучит
    const k = 0.5 - 0.5 * Math.cos(Math.PI * t);
    const f = F_LOW + (F_HIGH - F_LOW) * k;
    phase += (2 * Math.PI * f) / SR;
    pcm[idx++] = Math.round(Math.sin(phase) * AMP * 32767);
  }
  // down-sweep
  for (let i = 0; i < samplesPerSweep; i++) {
    const t = i / samplesPerSweep;
    const k = 0.5 - 0.5 * Math.cos(Math.PI * t);
    const f = F_HIGH - (F_HIGH - F_LOW) * k;
    phase += (2 * Math.PI * f) / SR;
    pcm[idx++] = Math.round(Math.sin(phase) * AMP * 32767);
  }
}

// Косинус-фейд на старте и конце.
for (let i = 0; i < fadeSamples; i++) {
  const k = 0.5 - 0.5 * Math.cos((Math.PI * i) / fadeSamples);
  pcm[i] = Math.round(pcm[i] * k);
  pcm[totalSamples - 1 - i] = Math.round(pcm[totalSamples - 1 - i] * k);
}

// WAV PCM 16-bit mono обёртка.
const dataBytes = pcm.byteLength;
const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + dataBytes, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(1, 22);
header.writeUInt32LE(SR, 24);
header.writeUInt32LE(SR * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(dataBytes, 40);

const wav = Buffer.concat([header, Buffer.from(pcm.buffer)]);
writeFileSync(OUT, wav);
console.log(`✓ ${OUT} (${(wav.length / 1024).toFixed(1)} KB, ${(totalSamples / SR).toFixed(2)}s)`);
