// The mobile theme IS the tokens package — this module just adds RN-specific
// derivations. Styling rule: if a value isn't a token, it isn't in the design.
import { color, statusColor, statusLabel, radius, space, font, shadow, STATUSES } from "@pipeline/tokens";

export { color, statusColor, statusLabel, radius, space, font, shadow, STATUSES };

/** Body text style everything inherits from (desktop: 15px/1.5 system stack). */
export const text = {
  base: { color: color.text, fontSize: font.size.md, lineHeight: font.size.md * font.lineHeight },
  dim: { color: color.textDim, fontSize: font.size.md, lineHeight: font.size.md * font.lineHeight },
  faint: { color: color.textFaint, fontSize: font.size.sm, lineHeight: font.size.sm * font.lineHeight },
  title: { color: color.text, fontSize: font.size.xl, fontWeight: font.weight.bold as "700" },
  hero: { color: color.text, fontSize: font.size.hero, fontWeight: font.weight.bold as "700" },
} as const;

/** The desktop's panel look: raised dark surface with a hairline border. */
export const panel = {
  backgroundColor: color.panel,
  borderColor: color.border,
  borderWidth: 1,
  borderRadius: radius.md,
} as const;
