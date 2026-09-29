// Input-method (IME) guard.
//
// CladeForge's primary UI language is Chinese, so a Pinyin / Zhuyin / Korean /
// Japanese composition session is open on the canvas and in every field most of
// the time. While a candidate list is showing, the browser still delivers the
// physical keystrokes to the page: pressing Enter to ACCEPT a candidate arrives
// as a plain `keydown` with key === 'Enter'. Without a guard that keystroke
// blurs the field (committing a half-written label), runs the highlighted
// command in the ⌘K palette, closes a dialog on Escape, or deletes the selected
// nodes — the composition silently becomes an editing action.
//
// The rule is therefore: no keyboard SHORTCUT or COMMIT may fire while the user
// is composing. `KeyboardEvent.isComposing` is the standard signal; `keyCode ===
// 229` is the legacy fallback WebKit/Safari need, where a composition keystroke
// reports an unspecified key code and `isComposing` can be false in the same
// tick (notably the final Enter that confirms a candidate on some engines).
//
// Both React synthetic events (pass the event itself — `nativeEvent` is read)
// and native `KeyboardEvent`s (window/document listeners) are accepted, so one
// helper covers every handler path in the app.

/** Minimal structural shape both event flavours satisfy. */
interface CompositionBearing {
  isComposing?: boolean;
  keyCode?: number;
  nativeEvent?: { isComposing?: boolean; keyCode?: number };
}

/** True while an IME composition session owns the keystroke. */
export function isImeComposing(e: CompositionBearing | null | undefined): boolean {
  if (!e) return false;
  const native = e.nativeEvent ?? e;
  if (native.isComposing) return true;
  // 229 = the "unresolved" key code every engine uses during composition.
  return native.keyCode === 229;
}

/**
 * Wrap a keyboard handler so composition keystrokes are ignored. Use it at every
 * `addEventListener('keydown', …)` and `onKeyDown={…}` site that triggers an
 * action rather than plain text entry.
 */
export function imeSafe<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void {
  return (...args: A) => {
    const event = args[0] as CompositionBearing | undefined;
    if (isImeComposing(event)) return;
    fn(...args);
  };
}
