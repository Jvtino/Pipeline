// Inline SVG icon set — stroke style, matching the redesign prototype. Each icon
// takes a size/stroke/color and inherits currentColor by default, so callers
// control color via CSS `color` or an explicit `color` prop.
import type { CSSProperties } from "react";

interface IconProps {
  size?: number;
  stroke?: number;
  color?: string;
  style?: CSSProperties;
  className?: string;
}

function svgProps({ size = 18, color = "currentColor", style, className }: IconProps, stroke?: number) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none" as const,
    stroke: color,
    strokeWidth: stroke,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    style,
    className,
  };
}

/* ---- Pipeline logo (4-bar descending mark, colored by 4 primary statuses) -- */
export function Logo({ size = 26, style }: { size?: number; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style} aria-hidden>
      <rect x="3" y="3.5" width="18" height="3" rx="1.5" fill="#6c7d96" />
      <rect x="5" y="8.5" width="14" height="3" rx="1.5" fill="#c08a2a" />
      <rect x="7" y="13.5" width="10" height="3" rx="1.5" fill="#2f9266" />
      <rect x="9" y="18.5" width="6" height="3" rx="1.5" fill="#c06a57" />
    </svg>
  );
}

/* ---- nav icons ------------------------------------------------------------ */
export const IconDashboard = (p: IconProps) => (
  <svg {...svgProps(p, p.stroke ?? 1.8)}>
    <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
    <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
    <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
    <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
  </svg>
);
export const IconApplications = (p: IconProps) => (
  <svg {...svgProps(p, p.stroke ?? 1.8)}>
    <path d="M3 6h18M3 12h18M3 18h12" />
  </svg>
);
export const IconCompanies = (p: IconProps) => (
  <svg {...svgProps(p, p.stroke ?? 1.8)}>
    <rect x="4" y="8" width="16" height="13" rx="1.5" />
    <path d="M9 21v-4h6v4M9 12h.01M15 12h.01M8 4h8v4H8z" />
  </svg>
);
export const IconContacts = (p: IconProps) => (
  <svg {...svgProps(p, p.stroke ?? 1.8)}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 20a5.5 5.5 0 0 1 11 0M16.5 5.5a3 3 0 0 1 0 6M18 20a5.5 5.5 0 0 0-3-4.9" />
  </svg>
);
export const IconCalendar = (p: IconProps) => (
  <svg {...svgProps(p, p.stroke ?? 1.8)}>
    <rect x="3" y="4.5" width="18" height="16.5" rx="2" />
    <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
  </svg>
);
export const IconTasks = (p: IconProps) => (
  <svg {...svgProps(p, p.stroke ?? 1.8)}>
    <rect x="3" y="3" width="18" height="18" rx="2.5" />
    <path d="m8 12 2.8 2.8L16 9" />
  </svg>
);
export const IconStatistics = (p: IconProps) => (
  <svg {...svgProps(p, p.stroke ?? 1.8)}>
    <path d="M4 20V11M10 20V4M16 20v-6M22 20H2" />
  </svg>
);
export const IconDocuments = (p: IconProps) => (
  <svg {...svgProps(p, p.stroke ?? 1.8)}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
  </svg>
);
export const IconTemplates = (p: IconProps) => (
  <svg {...svgProps(p, p.stroke ?? 1.8)}>
    <rect x="4" y="4" width="16" height="6" rx="1.5" />
    <rect x="4" y="14" width="7" height="6" rx="1.5" />
    <rect x="14" y="14" width="6" height="6" rx="1.5" />
  </svg>
);
export const IconSettings = (p: IconProps) => (
  <svg {...svgProps(p, p.stroke ?? 1.8)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
  </svg>
);

/* ---- ui icons ------------------------------------------------------------- */
export const IconChevronRight = (p: IconProps) => (
  <svg {...svgProps(p, p.stroke ?? 2)}>
    <path d="m9 6 6 6-6 6" />
  </svg>
);
export const IconSearch = (p: IconProps) => (
  <svg {...svgProps(p, p.stroke ?? 2)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3-3" />
  </svg>
);
export const IconRefresh = (p: IconProps) => (
  <svg {...svgProps(p, p.stroke ?? 2)}>
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <path d="M21 3v5h-5" />
  </svg>
);
export const IconPlus = (p: IconProps) => (
  <svg {...svgProps(p, p.stroke ?? 2.2)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const IconBell = (p: IconProps) => (
  <svg {...svgProps(p, p.stroke ?? 1.9)}>
    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />
  </svg>
);
export const IconBolt = (p: IconProps) => (
  <svg {...svgProps(p, p.stroke ?? 2)}>
    <path d="M13 2 3 14h9l-1 8 10-12h-9z" />
  </svg>
);
export const IconClock = (p: IconProps) => (
  <svg {...svgProps(p, p.stroke ?? 2)}>
    <path d="M12 8v4l3 2" />
    <circle cx="12" cy="12" r="9" />
  </svg>
);
export const IconCheck = (p: IconProps) => (
  <svg {...svgProps(p, p.stroke ?? 3)}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);
export const IconX = (p: IconProps) => (
  <svg {...svgProps(p, p.stroke ?? 2.2)}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);
export const IconMail = (p: IconProps) => (
  <svg {...svgProps(p, p.stroke ?? 2)}>
    <rect x="2.5" y="5" width="19" height="14" rx="2" />
    <path d="m3 7 9 6 9-6" />
  </svg>
);
export const IconShield = (p: IconProps) => (
  <svg {...svgProps(p, p.stroke ?? 2)}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);
export const IconDownload = (p: IconProps) => (
  <svg {...svgProps(p, p.stroke ?? 1.9)}>
    <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" />
  </svg>
);
export const IconCloudOff = (p: IconProps) => (
  <svg {...svgProps(p, p.stroke ?? 1.8)}>
    <path d="M18.4 18.4A8 8 0 0 0 6 7.6M3 3l18 18M5.6 9A8 8 0 0 0 12 20a8 8 0 0 0 4-1" />
  </svg>
);
export const IconBox = (p: IconProps) => (
  <svg {...svgProps(p, p.stroke ?? 1.6)}>
    <path d="M3 8.5 12 13l9-4.5M3 8.5 12 4l9 4.5v7L12 20l-9-4.5z" />
  </svg>
);
export const IconChevronDown = (p: IconProps) => (
  <svg {...svgProps(p, p.stroke ?? 2)}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);
