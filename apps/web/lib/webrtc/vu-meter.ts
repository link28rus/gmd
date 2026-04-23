// apps/web/lib/webrtc/vu-meter.ts
/**
 * Запускает RAF-loop, считающий RMS-level (0..1) из MediaStream audio track.
 * Колбэк вызывается ~60 fps. Возвращает функцию для остановки.
 */
export function createVuMeter(stream: MediaStream, onLevel: (level: number) => void): () => void {
  const audioCtx = new (
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  )();
  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);

  const data = new Uint8Array(analyser.fftSize);
  let raf = 0;
  let stopped = false;

  const tick = () => {
    if (stopped) return;
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / data.length);
    onLevel(Math.min(1, rms * 3));
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    source.disconnect();
    void audioCtx.close();
  };
}
