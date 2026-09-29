// Functional / semantic colour constants for the canvas and export pipeline.
//
// These mirror the --c-* CSS custom properties in app.css :root. SVG
// presentation attributes cannot reference CSS var() directly, so the values
// are duplicated here as named constants. The values below are the light-theme
// palette; they remain legible on the (typically light, user-chosen) canvas
// background under either chrome theme. The chrome itself adapts to dark mode
// purely through the CSS variables.

/** Colour for the selection ring and the connection port handle (near-black). */
export const C_SELECT = '#18181b';
/** Colour for the reparent drop-target highlight ring (slate). */
export const C_DROP = '#52525b';
/** Colour for the connect-source highlight ring (clay). */
export const C_CONNECT = '#b05656';
/** Colour for the MRCA highlight ring and path-between branches (amber). */
export const C_MRCA = '#c8862a';
/** Colour for the MRCA label text. */
export const C_MRCA_TEXT = '#8a5d1e';
/** Colour for an unassigned / unknown character-state marker outline. */
export const C_UNKNOWN = '#9ca3af';
/** Fallback fill for a transition target circle when no state colour exists. */
export const C_TRANSITION_TO = '#3f3f46';

// --- Export-figure palette (centralised, was scattered inline) ---
// Warm monochrome equivalents of the canvas tokens, hardcoded because exported
// SVG / PDF files are self-contained and cannot reference CSS variables.

/** Axis tick label colour in exported figures. */
export const FIG_AXIS = '#787774';
/** Axis tick line colour in exported figures. */
export const FIG_TICK = '#eaeaea';
/** Legend / era label text colour in exported figures. */
export const FIG_LEGEND = '#1a1a1a';
/** Era band label text colour in exported figures. */
export const FIG_ERA = '#787774';
/** Environmental event label text colour in exported figures. */
export const FIG_ENV = '#1a1a1a';
/** Causal-chain arrow colour in exported figures. */
export const FIG_CAUSAL = '#787774';
/** Legend swatch border colour in exported figures. */
export const FIG_LEGEND_BORDER = '#d4d4d2';
/** ASR pie chart stroke colour in exported figures. */
export const FIG_ASR_STROKE = '#1a1a1a';
