// Functional / semantic colour constants for the canvas and export pipeline.
//
// These mirror the --c-* CSS custom properties in app.css :root. SVG
// presentation attributes cannot reference CSS var() directly, so the values
// are duplicated here as named constants. The values below are the light-theme
// palette; they remain legible on the (typically light, user-chosen) canvas
// background under either chrome theme. The chrome itself adapts to dark mode
// purely through the CSS variables.

/** Colour for the selection ring and the connection port handle (near-black). */
export const C_SELECT = '#202020';
/** Colour for the reparent drop-target highlight ring (slate). */
export const C_DROP = '#646464';
/** Colour for the connect-source highlight ring (clay). */
export const C_CONNECT = '#6e56cf';
/** Colour for the MRCA highlight ring and path-between branches (amber). */
export const C_MRCA = '#ab6400';
/** Colour for the MRCA label text. */
export const C_MRCA_TEXT = '#ab6400';
/** Colour for an unassigned / unknown character-state marker outline. */
export const C_UNKNOWN = '#8d8d8d';
/** Fallback fill for a transition target circle when no state colour exists. */
export const C_TRANSITION_TO = '#646464';

// --- Export-figure palette (centralised, was scattered inline) ---
// Warm monochrome equivalents of the canvas tokens, hardcoded because exported
// SVG / PDF files are self-contained and cannot reference CSS variables.

/** Axis tick label colour in exported figures. */
export const FIG_AXIS = '#646464';
/** Axis tick line colour in exported figures. */
export const FIG_TICK = '#e0e0e0';
/** Legend / era label text colour in exported figures. */
export const FIG_LEGEND = '#202020';
/** Era band label text colour in exported figures. */
export const FIG_ERA = '#646464';
/** Environmental event label text colour in exported figures. */
export const FIG_ENV = '#202020';
/** Causal-chain arrow colour in exported figures. */
export const FIG_CAUSAL = '#646464';
/** Legend swatch border colour in exported figures. */
export const FIG_LEGEND_BORDER = '#cecece';
/** ASR pie chart stroke colour in exported figures. */
export const FIG_ASR_STROKE = '#202020';
