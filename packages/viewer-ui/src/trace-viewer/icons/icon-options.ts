/**
 * Shared option types for the scannability edge icon.
 *
 *  - `IconSide` — which outer edge the chip abuts. Default "left": you scan a
 *    tree top-to-bottom, so a left-edge glyph reads first.
 *  - `IconStyle` — the visual treatment, undecided by the owner and offered as
 *    a toggle: "outline" is a hollow accent-bordered chip with an accent glyph;
 *    "solid" is an accent-filled chip with the glyph knocked out to the card
 *    background.
 */
export type IconSide = "left" | "right";
export type IconStyle = "outline" | "solid";

export const DEFAULT_ICON_SIDE: IconSide = "left";
export const DEFAULT_ICON_STYLE: IconStyle = "outline";
