// AudioWorkletProcessor для проигрывания PCM, поступающего через postMessage
// (Float32Array, mono, sampleRate AudioContext'а — мы выставляем 48 kHz, opus-decoder
// тоже отдаёт 48 kHz, поэтому resampler не нужен).
//
// Без SharedArrayBuffer — postMessage с transferable buffer достаточно дёшев для
// 20-мс Opus-фреймов (один фрейм на 48kHz mono = 960 семплов = 3.75 KB Float32).
// Единственный недостаток — ~5-10 мс jitter из-за message-passing, но для
// мониторинга голоса неслышимо.
//
// Underflow (нет данных в очереди) → out заполняется нулями, что в браузере звучит
// как тишина без артефактов. Так и должно быть в моменты сетевого jitter.

class AudioPlayerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.position = 0; // позиция в первом chunk'е очереди
    this.port.onmessage = (e) => {
      const data = e.data;
      if (data instanceof Float32Array) {
        this.queue.push(data);
      } else if (data && data.type === 'reset') {
        this.queue = [];
        this.position = 0;
      }
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0][0]; // mono channel
    if (!out) return true;
    let written = 0;
    while (written < out.length && this.queue.length > 0) {
      const chunk = this.queue[0];
      const remaining = chunk.length - this.position;
      const toWrite = Math.min(out.length - written, remaining);
      for (let i = 0; i < toWrite; i++) {
        out[written + i] = chunk[this.position + i];
      }
      written += toWrite;
      this.position += toWrite;
      if (this.position >= chunk.length) {
        this.queue.shift();
        this.position = 0;
      }
    }
    // Underflow: остаток буфера уже заполнен нулями (Float32Array initialiser).
    return true;
  }
}

registerProcessor('audio-player', AudioPlayerProcessor);
