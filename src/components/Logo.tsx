import { useId } from "react";

/** Градиентный квадрат с белым «V»-эквалайзером из 5 полосок. */
export function LogoMark({ size = 32, animated = false }: { size?: number; animated?: boolean }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg className="vlogo" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" style={{ width: size, height: size }}>
      <defs>
        <linearGradient id={`vlg${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FF6B9A" />
          <stop offset=".5" stopColor="#A55CF5" />
          <stop offset="1" stopColor="#3D8BFF" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#vlg${id})`} />
      <g fill="#FFFFFF" className={animated ? "eq" : undefined}>
        <rect x="6.5" y="8" width="2.5" height="16" rx="1.25" />
        <rect x="10.75" y="10.5" width="2.5" height="11" rx="1.25" />
        <rect x="15" y="13" width="2.5" height="6" rx="1.25" />
        <rect x="19.25" y="10.5" width="2.5" height="11" rx="1.25" />
        <rect x="23.5" y="8" width="2.5" height="16" rx="1.25" />
      </g>
    </svg>
  );
}

export function Brand() {
  return (
    <span className="hbrand">
      Vibe<span>On</span>
    </span>
  );
}
