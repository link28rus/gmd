#!/usr/bin/env node
// Генератор WAV-файла для громкого сигнала «Найди телефон» (mobile-child).
//
// Получаем максимально пронзительный alarm-pattern:
//   • Чередование квадратных волн на 2500 Hz и 3500 Hz по 250 мс каждая
//     (Fletcher-Munson — пик чувствительности уха ~2-4 кГц).
//   • Квадратная волна вместо синуса даёт богатые гармоники → психо-
//     акустически громче на той же RMS-мощности.
//   • Амплитуда 0.85 от full-scale — небольшой headroom, чтобы resampler
//     устройства не клипал при пересчёте 44100 Hz → device sample rate.
//   • 8 циклов = 4 секунды; MediaPlayer.isLooping=true зацикливает
//     бесшовно, потому что обе границы цикла на нулевом переходе.
//   • 5-мс косинусный fade-in/fade-out на самой первой и самой последней
//     четверти периода — убирает «pop» в начале первого и конца последнего
//     цикла. Внутри файла фазовый стык между сегментами не глажу — резкий
//     переход тона звучит как сирена и так и задумано.
//
// Запуск:
//   node scripts/gen-signal-sound.mjs
// Артефакт:
//   apps/mobile-child/android/app/src/main/res/raw/signal_alarm.wav

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(
  __dirname,
  '..',
  'apps',
  'mobile-child',
  'android',
  'app',
  'src',
  'main',
  'res',
  'raw',
  'signal_alarm.wav',
);

const SR = 44100;
const AMP = 0.85;
const SEGMENT_MS = 250;
const FREQ_A = 2500;
const FREQ_B = 3500;
const CYCLES = 8;
const FADE_MS = 5;

const samplesPerSegment = Math.floor((SR * SEGMENT_MS) / 1000);
const totalSamples = samplesPerSegment * 2 * CYCLES;
const fadeSamples = Math.floor((SR * FADE_MS) / 1000);

const pcm = new Int16Array(totalSamples);

function squareSample(phase) {
  // phase в радианах; sign(sin(phase)) даёт меандр.
  return Math.sin(phase) >= 0 ? 1 : -1;
}

let idx = 0;
for (let c = 0; c < CYCLES; c++) {
  for (const f of [FREQ_A, FREQ_B]) {
    const omega = (2 * Math.PI * f) / SR;
    for (let i = 0; i < samplesPerSegment; i++) {
      const v = squareSample(omega * i) * AMP;
      pcm[idx++] = Math.round(v * 32767);
    }
  }
}

// Косинус-фейд на первых FADE_MS и последних FADE_MS.
for (let i = 0; i < fadeSamples; i++) {
  const k = 0.5 - 0.5 * Math.cos((Math.PI * i) / fadeSamples);
  pcm[i] = Math.round(pcm[i] * k);
  pcm[totalSamples - 1 - i] = Math.round(pcm[totalSamples - 1 - i] * k);
}

// WAV-обёртка (canonical PCM, 16-bit mono).
const dataBytes = pcm.byteLength;
const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + dataBytes, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16); // PCM chunk size
header.writeUInt16LE(1, 20); // format = PCM
header.writeUInt16LE(1, 22); // channels
header.writeUInt32LE(SR, 24);
header.writeUInt32LE(SR * 2, 28); // byte rate (1ch × 16bit / 8 = 2)
header.writeUInt16LE(2, 32); // block align
header.writeUInt16LE(16, 34); // bits per sample
header.write('data', 36);
header.writeUInt32LE(dataBytes, 40);

const wav = Buffer.concat([header, Buffer.from(pcm.buffer)]);
writeFileSync(OUT, wav);
console.log(`✓ ${OUT} (${(wav.length / 1024).toFixed(1)} KB, ${(totalSamples / SR).toFixed(2)}s)`);
