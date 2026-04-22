import Link from 'next/link';
import type { ReactElement } from 'react';

const APP_VERSION = process.env.APP_VERSION ?? '';

/**
 * 4 GPS-маркера расставлены по углам SVG-холста (viewBox 1440×900). Каждый
 * пульсирует двумя кольцами в противофазе (сдвиг 1.3s), чтобы живой эффект
 * радара не ощущался метрономным. `delay` — стартовая задержка для первого
 * кольца конкретного маркера, второе кольцо стартует с +1.3s.
 */
const MARKERS: Array<{ x: number; y: number; delay: number }> = [
  { x: 190, y: 205, delay: 0 },
  { x: 1255, y: 175, delay: 0.9 },
  { x: 1265, y: 705, delay: 1.8 },
  { x: 245, y: 735, delay: 2.5 },
];

export default function HomePage(): ReactElement {
  return (
    <div className="relative h-screen overflow-hidden bg-[#050a15] text-slate-100">
      {/* Фон: карта + анимация. Всё в одном SVG с preserveAspectRatio="slice"
          чтобы координаты маршрутов и маркеров совпадали при любом размере
          окна (как object-fit: cover). */}
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <radialGradient id="centerGlow" cx="50%" cy="50%" r="55%">
            <stop offset="0%" stopColor="rgba(56,189,248,0.18)" />
            <stop offset="42%" stopColor="rgba(56,189,248,0.05)" />
            <stop offset="100%" stopColor="rgba(56,189,248,0)" />
          </radialGradient>
          <linearGradient id="roadGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(148,163,184,0)" />
            <stop offset="50%" stopColor="rgba(148,163,184,0.12)" />
            <stop offset="100%" stopColor="rgba(148,163,184,0)" />
          </linearGradient>
          <filter id="pinGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Глубокий голубой glow за центром */}
        <rect width="1440" height="900" fill="url(#centerGlow)" />

        {/* «Магистрали» — широкие мягкие кривые, читаются как подложка карты */}
        <g fill="none" strokeLinecap="round">
          <path
            d="M -100 600 C 200 540, 420 730, 740 520 S 1120 290, 1600 370"
            stroke="url(#roadGrad)"
            strokeWidth="48"
          />
          <path
            d="M -100 280 C 280 380, 580 220, 860 320 S 1280 480, 1600 420"
            stroke="url(#roadGrad)"
            strokeWidth="30"
          />
          <path
            d="M 300 -50 C 260 200, 420 400, 360 620 S 420 920, 380 1000"
            stroke="url(#roadGrad)"
            strokeWidth="26"
          />
          <path
            d="M 1100 -50 C 1160 220, 1000 420, 1100 640 S 1220 900, 1160 1000"
            stroke="url(#roadGrad)"
            strokeWidth="26"
          />
        </g>

        {/* Тонкие «улицы» второго уровня — ровные штрихи для текстуры */}
        <g fill="none" stroke="rgba(148,163,184,0.06)" strokeWidth="1">
          <path d="M -50 150 L 1500 380" />
          <path d="M 200 -50 L 650 950" />
          <path d="M 1000 -50 L 1300 950" />
          <path d="M -50 700 L 1500 450" />
          <path d="M 720 -50 L 720 950" />
        </g>

        {/* Маршруты между маркерами — светящийся анимированный пунктир.
            4 сегмента замкнуты в кольцо A→B→C→D→A, разные скорости чтобы
            визуально не «тикало» синхронно. */}
        <g fill="none" stroke="rgba(56,189,248,0.55)" strokeWidth="1.4" strokeLinecap="round">
          <path d="M 190 205 Q 720 90 1255 175" strokeDasharray="5 10">
            <animate
              attributeName="stroke-dashoffset"
              from="0"
              to="-30"
              dur="2.2s"
              repeatCount="indefinite"
            />
          </path>
          <path d="M 1255 175 Q 1390 440 1265 705" strokeDasharray="5 10">
            <animate
              attributeName="stroke-dashoffset"
              from="0"
              to="-30"
              dur="2.6s"
              repeatCount="indefinite"
            />
          </path>
          <path d="M 1265 705 Q 760 870 245 735" strokeDasharray="5 10">
            <animate
              attributeName="stroke-dashoffset"
              from="0"
              to="-30"
              dur="3s"
              repeatCount="indefinite"
            />
          </path>
          <path d="M 245 735 Q 60 460 190 205" strokeDasharray="5 10">
            <animate
              attributeName="stroke-dashoffset"
              from="0"
              to="-30"
              dur="2.8s"
              repeatCount="indefinite"
            />
          </path>
        </g>

        {/* GPS-маркеры: два расширяющихся кольца (в противофазе) + teardrop-пин. */}
        {MARKERS.map((m, i) => (
          <g key={i} transform={`translate(${m.x} ${m.y})`}>
            <circle r="4" fill="none" stroke="rgba(56,189,248,0.55)" strokeWidth="1.5">
              <animate
                attributeName="r"
                from="4"
                to="44"
                dur="2.6s"
                begin={`${m.delay}s`}
                repeatCount="indefinite"
              />
              <animate
                attributeName="opacity"
                from="0.9"
                to="0"
                dur="2.6s"
                begin={`${m.delay}s`}
                repeatCount="indefinite"
              />
            </circle>
            <circle r="4" fill="none" stroke="rgba(56,189,248,0.55)" strokeWidth="1.5">
              <animate
                attributeName="r"
                from="4"
                to="44"
                dur="2.6s"
                begin={`${m.delay + 1.3}s`}
                repeatCount="indefinite"
              />
              <animate
                attributeName="opacity"
                from="0.9"
                to="0"
                dur="2.6s"
                begin={`${m.delay + 1.3}s`}
                repeatCount="indefinite"
              />
            </circle>
            <path
              d="M 0 -17 C -9 -17 -12 -10 -12 -5 C -12 5 0 15 0 15 C 0 15 12 5 12 -5 C 12 -10 9 -17 0 -17 Z"
              fill="rgb(56,189,248)"
              filter="url(#pinGlow)"
            />
            <circle cy="-6" r="3.2" fill="rgb(15,23,42)" />
          </g>
        ))}
      </svg>

      {/* Верхний правый угол — только «Скачать приложение». Лого кабинета
          на landing не нужен — его место в центре композиции. */}
      <header className="relative z-10 flex items-center justify-end px-6 py-5">
        <Link
          href="/download"
          className="inline-flex items-center gap-2 rounded-md border border-slate-700/70 bg-slate-900/60 px-4 py-2 text-sm font-medium text-slate-100 backdrop-blur-md transition hover:border-sky-400/50 hover:bg-slate-900/80 hover:text-white"
        >
          Скачать приложение
        </Link>
      </header>

      {/* Hero */}
      <main className="relative z-10 flex h-[calc(100vh-72px)] flex-col items-center justify-center px-4 text-center">
        <h1
          className="bg-gradient-to-b from-white to-sky-200/70 bg-clip-text text-7xl font-bold tracking-tight text-transparent drop-shadow-[0_8px_28px_rgba(56,189,248,0.25)] sm:text-8xl"
          style={{ animation: 'fade-up 0.7s ease-out both' }}
        >
          GMD
        </h1>
        <p
          className="mt-4 max-w-xl text-base text-slate-300/90 sm:text-lg"
          style={{ animation: 'fade-up 0.7s ease-out 0.12s both' }}
        >
          Сервис родительского контроля и геолокации детей
        </p>
        <Link
          href="/login"
          className="mt-10 inline-flex items-center justify-center rounded-lg bg-sky-500 px-8 py-3 text-sm font-semibold text-white shadow-[0_0_0_1px_rgba(56,189,248,0.45),0_8px_28px_-8px_rgba(56,189,248,0.65)] transition hover:bg-sky-400 hover:shadow-[0_0_0_1px_rgba(125,211,252,0.55),0_14px_36px_-8px_rgba(56,189,248,0.85)]"
          style={{ animation: 'fade-up 0.7s ease-out 0.24s both' }}
        >
          Войти
        </Link>
        <p
          className="mt-8 text-xs tracking-wide text-slate-500"
          style={{ animation: 'fade-up 0.7s ease-out 0.36s both' }}
        >
          v{APP_VERSION} — MVP
        </p>
      </main>
    </div>
  );
}
