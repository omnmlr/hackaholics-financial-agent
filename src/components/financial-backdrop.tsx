/** Decorative data texture from the approved reference, never financial output. */
export function FinancialBackdrop() {
  return (
    <svg
      className="agus-financial-backdrop"
      viewBox="0 0 1672 941"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <pattern
          id="agus-data-dots"
          width="23"
          height="25"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="17" cy="16" r="0.8" fill="#66717d" />
        </pattern>
        <radialGradient id="agus-data-fade">
          <stop stopColor="white" stopOpacity="0.34" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </radialGradient>
        <mask id="agus-data-mask">
          <ellipse
            cx="90"
            cy="568"
            rx="580"
            ry="460"
            fill="url(#agus-data-fade)"
          />
          <ellipse
            cx="1520"
            cy="255"
            rx="550"
            ry="370"
            fill="url(#agus-data-fade)"
          />
        </mask>
        <linearGradient id="agus-data-bars" x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#67737f" stopOpacity="0.21" />
          <stop offset="1" stopColor="#2c3742" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="agus-data-left-line">
          <stop stopColor="#596c80" />
          <stop offset="0.6" stopColor="#596c80" />
          <stop offset="1" stopColor="#596c80" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="agus-data-right-line">
          <stop stopColor="#596c80" stopOpacity="0" />
          <stop offset="0.4" stopColor="#596c80" />
          <stop offset="1" stopColor="#596c80" />
        </linearGradient>
        <filter
          id="agus-data-glow"
          x="-400%"
          y="-400%"
          width="900%"
          height="900%"
        >
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>
      <path
        fill="url(#agus-data-dots)"
        mask="url(#agus-data-mask)"
        d="M0 0h1672v941H0z"
      />
      <g fill="url(#agus-data-bars)">
        {[
          62, 100, 145, 172, 198, 176, 131, 232, 187, 125, 105, 82, 66, 80, 54,
          96, 63, 42, 29, 20, 48, 24, 35, 15,
        ].map((height, i) => (
          <rect
            key={`left-${i}`}
            x={18 + i * 21}
            y={678 - height}
            width="4"
            height={height}
            rx="1.5"
          />
        ))}
        {[
          162, 130, 72, 183, 61, 92, 107, 167, 149, 207, 141, 234, 222, 187,
          255, 199, 279, 350, 259, 313,
        ].map((height, i) => (
          <rect
            key={`right-${i}`}
            x={1292 + i * 19}
            y={400 - height + (i < 4 ? 0 : 60)}
            width="4"
            height={height}
            rx="1.5"
          />
        ))}
      </g>
      <g fill="none" stroke="#596c80" strokeWidth="1">
        <path
          opacity="0.32"
          stroke="url(#agus-data-left-line)"
          d="M-20 702C120 596 192 592 290 626S425 708 505 721S650 757 720 714S820 616 923 588"
        />
        <path
          opacity="0.12"
          d="M430 697C570 674 646 727 743 724S874 664 1017 634"
        />
        <path
          opacity="0.32"
          stroke="url(#agus-data-right-line)"
          d="M1055 414C1158 319 1182 317 1259 319S1371 271 1478 178S1601 80 1690 53"
        />
        <path opacity="0.19" d="M1275 455C1403 416 1501 278 1690 253" />
      </g>
      {[
        [268, 620],
        [495, 720],
        [1478, 178],
      ].map(([cx, cy]) => (
        <g key={cx}>
          <circle
            cx={cx}
            cy={cy}
            r="6"
            fill="#3289ff"
            opacity="0.4"
            filter="url(#agus-data-glow)"
          />
          <circle cx={cx} cy={cy} r="2.6" fill="#5aa5ff" />
        </g>
      ))}
    </svg>
  );
}
