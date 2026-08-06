// Hand-rolled SVG tab icons — same ethos as the desktop and web apps (inline
// SVG, no icon font). Stroke inherits the tab bar's tint via the color prop.
import type { ColorValue } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";

interface IconProps {
  color: ColorValue;
  size?: number;
}

export function IconBoard({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="3" y="4" width="7" height="16" rx="2" stroke={color} strokeWidth="1.8" />
      <Rect x="14" y="4" width="7" height="10" rx="2" stroke={color} strokeWidth="1.8" />
    </Svg>
  );
}

export function IconCalendar({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="3" y="5" width="18" height="16" rx="2" stroke={color} strokeWidth="1.8" />
      <Path d="M3 10h18M8 3v4M16 3v4" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </Svg>
  );
}

export function IconBell({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M6 9a6 6 0 1 1 12 0c0 4 1.5 5.5 2 6H4c.5-.5 2-2 2-6Z"
        stroke={color}
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <Path d="M10 18a2 2 0 0 0 4 0" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </Svg>
  );
}

export function IconSettings({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="3.2" stroke={color} strokeWidth="1.8" />
      <Path
        d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </Svg>
  );
}
