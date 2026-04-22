import type { ReactElement } from 'react';

/**
 * Общий фон для auth-страниц (/login, /register, /confirm-email) — тёмно-
 * синяя карта с четырьмя подписанными GPS-маркерами и анимированными
 * пунктирными маршрутами между ними. Сам div-обёртку + слой blur оставляем
 * на вызывающей странице, здесь — только SVG.
 */
const MARKERS: Array<{
  x: number;
  y: number;
  label: string;
  labelWidth: number;
  delay: number;
}> = [
  { x: 220, y: 185, label: 'Дом', labelWidth: 56, delay: 0 },
  { x: 1245, y: 225, label: 'Школа', labelWidth: 74, delay: 0.8 },
  { x: 1260, y: 695, label: 'Секция', labelWidth: 82, delay: 1.6 },
  { x: 195, y: 720, label: 'Бабушка', labelWidth: 94, delay: 2.4 },
];

export function AuthMapBackground(): ReactElement {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 1440 900"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <radialGradient id="authCenterGlow" cx="50%" cy="50%" r="55%">
          <stop offset="0%" stopColor="rgba(56,189,248,0.20)" />
          <stop offset="42%" stopColor="rgba(56,189,248,0.06)" />
          <stop offset="100%" stopColor="rgba(56,189,248,0)" />
        </radialGradient>
        <linearGradient id="authRoadGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="rgba(148,163,184,0)" />
          <stop offset="50%" stopColor="rgba(148,163,184,0.12)" />
          <stop offset="100%" stopColor="rgba(148,163,184,0)" />
        </linearGradient>
        <filter id="authPinGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <rect width="1440" height="900" fill="url(#authCenterGlow)" />

      {/* «Магистрали» — извилистые S-образные cubic Bezier. */}
      <g fill="none" strokeLinecap="round">
        <path
          d="M -100 520 C 120 360, 320 640, 520 440 S 900 680, 1100 360 S 1320 560, 1600 440"
          stroke="url(#authRoadGrad)"
          strokeWidth="52"
        />
        <path
          d="M -100 320 C 200 520, 460 180, 720 380 S 1120 620, 1600 340"
          stroke="url(#authRoadGrad)"
          strokeWidth="34"
        />
        <path
          d="M 240 -60 C 160 220, 380 380, 260 600 S 440 920, 320 1000"
          stroke="url(#authRoadGrad)"
          strokeWidth="28"
        />
        <path
          d="M 1180 -60 C 1260 240, 1040 420, 1180 640 S 1280 920, 1160 1000"
          stroke="url(#authRoadGrad)"
          strokeWidth="28"
        />
        <path
          d="M -80 760 C 260 700, 520 820, 860 680 S 1280 820, 1600 700"
          stroke="url(#authRoadGrad)"
          strokeWidth="22"
        />
      </g>

      <g fill="none" stroke="rgba(148,163,184,0.06)" strokeWidth="1">
        <path d="M -50 180 C 300 260, 700 120, 1500 320" />
        <path d="M 120 -50 C 220 300, 80 600, 420 950" />
        <path d="M 980 -50 C 1080 280, 1240 520, 1340 950" />
        <path d="M -50 720 C 340 620, 780 840, 1500 620" />
        <path d="M 720 -50 C 680 300, 780 600, 720 950" />
      </g>

      {/* Маршруты между маркерами — замкнуты в кольцо Дом→Школа→Секция→Бабушка. */}
      <g fill="none" stroke="rgba(56,189,248,0.55)" strokeWidth="1.4" strokeLinecap="round">
        <path d="M 220 185 C 480 40, 820 360, 1245 225" strokeDasharray="5 10">
          <animate
            attributeName="stroke-dashoffset"
            from="0"
            to="-30"
            dur="2.2s"
            repeatCount="indefinite"
          />
        </path>
        <path d="M 1245 225 C 1440 380, 1100 540, 1260 695" strokeDasharray="5 10">
          <animate
            attributeName="stroke-dashoffset"
            from="0"
            to="-30"
            dur="2.7s"
            repeatCount="indefinite"
          />
        </path>
        <path d="M 1260 695 C 900 880, 540 540, 195 720" strokeDasharray="5 10">
          <animate
            attributeName="stroke-dashoffset"
            from="0"
            to="-30"
            dur="3.1s"
            repeatCount="indefinite"
          />
        </path>
        <path d="M 195 720 C 30 520, 380 380, 220 185" strokeDasharray="5 10">
          <animate
            attributeName="stroke-dashoffset"
            from="0"
            to="-30"
            dur="2.8s"
            repeatCount="indefinite"
          />
        </path>
      </g>

      {MARKERS.map((m) => (
        <g key={m.label} transform={`translate(${m.x} ${m.y})`}>
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
            filter="url(#authPinGlow)"
          />
          <circle cy="-6" r="3.2" fill="rgb(15,23,42)" />

          <rect
            x={-m.labelWidth / 2}
            y="24"
            width={m.labelWidth}
            height="22"
            rx="6"
            fill="rgba(10,15,25,0.88)"
            stroke="rgba(71,85,105,0.7)"
            strokeWidth="0.8"
          />
          <text
            x="0"
            y="35"
            textAnchor="middle"
            dominantBaseline="central"
            fontSize="13"
            fontWeight="500"
            fill="rgb(226,232,240)"
            style={{
              fontFamily: "var(--font-sans), system-ui, -apple-system, 'Segoe UI', sans-serif",
            }}
          >
            {m.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
