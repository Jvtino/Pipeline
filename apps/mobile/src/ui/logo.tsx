// The Pipeline mark — the site's logo (site/index.html) redrawn for React
// Native SVG: blue gradient tile, white envelope, and the four status chips
// that ARE the product. One component, any size.
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from "react-native-svg";

export function LogoMark({ size = 64 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 96 96">
      <Defs>
        <LinearGradient id="pipeline-b" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#5ea0ff" />
          <Stop offset="0.55" stopColor="#3168d8" />
          <Stop offset="1" stopColor="#16357d" />
        </LinearGradient>
        <LinearGradient id="pipeline-g" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#ffffff" stopOpacity="0.38" />
          <Stop offset="0.55" stopColor="#ffffff" stopOpacity="0" />
        </LinearGradient>
      </Defs>
      <Rect x="6" y="6" width="84" height="84" rx="22" fill="url(#pipeline-b)" />
      <Rect x="6" y="6" width="84" height="84" rx="22" fill="url(#pipeline-g)" />
      <Rect x="26" y="26" width="44" height="29" rx="7" fill="#ffffff" />
      <Path d="M29.5 30.5 L48 45 L66.5 30.5" fill="none" stroke="#3168d8" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
      <Rect x="26" y="64" width="9.6" height="7" rx="3" fill="#aeb9c9" />
      <Rect x="37.5" y="64" width="9.6" height="7" rx="3" fill="#f5c542" />
      <Rect x="49" y="64" width="9.6" height="7" rx="3" fill="#34d399" />
      <Rect x="60.4" y="64" width="9.6" height="7" rx="3" fill="#f0556b" />
    </Svg>
  );
}
