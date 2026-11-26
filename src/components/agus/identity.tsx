import Image from "next/image";
import s from "./workspace.module.css";

/** Original repository wordmark; no font replacement or regenerated glyphs. */
export function AgusBrand() {
  return (
    <Image
      className={s.brandImage}
      src="/brand/agus-wordmark-dark.png"
      width={128}
      height={42}
      alt="agus."
      priority
    />
  );
}

/** The founder-approved Counterpart companion, based on the supplied mascot. */
export function AgusCompanion({
  large = false,
  state = "idle",
}: {
  large?: boolean;
  state?: "idle" | "thinking" | "analyzing" | "privacy" | "completed";
}) {
  return (
    <span
      className={`${s.companion} ${large ? s.companionLarge : ""}`}
      data-state={state}
    >
      <svg
        viewBox="0 0 300 285"
        role="img"
        aria-label={state === "idle" ? "AGUS companion" : `AGUS ${state}`}
      >
        <g className={s.mascotOrbit}>
          <path
            d="M38 155C-5 105 254 163 270 199"
            fill="none"
            stroke="#f5f5f2"
            strokeWidth="7"
          />
        </g>
        <g className={s.mascotBody}>
          <path
            d="M66 181C75 159 79 127 101 91 122 55 151 36 181 40 222 43 246 75 248 110 252 149 231 191 209 213 185 237 165 249 147 242 140 240 143 229 133 230 112 236 75 250 60 233 47 220 55 203 66 181Z"
            fill="#f5f5f2"
          />
          <g className={s.mascotEyes} fill="#101010">
            <rect
              x="174"
              y="91"
              width="13"
              height="31"
              rx="6.5"
              transform="rotate(-29 174 91)"
            />
            <rect
              x="207"
              y="76"
              width="13"
              height="31"
              rx="6.5"
              transform="rotate(-29 207 76)"
            />
          </g>
          <g
            className={s.mascotClosedEyes}
            fill="none"
            stroke="#101010"
            strokeWidth="6"
            strokeLinecap="round"
          >
            <path d="M166 110q8 12 17-1M200 95q8 12 17-1" />
          </g>
        </g>
        <path
          d="M30 151C15 184 229 247 270 199"
          fill="none"
          stroke="#101010"
          strokeWidth="16"
        />
        <path
          d="M30 151C15 184 229 247 270 199"
          fill="none"
          stroke="#f5f5f2"
          strokeWidth="6"
        />
      </svg>
    </span>
  );
}
