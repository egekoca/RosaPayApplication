import {Platform} from 'react-native';

const sansFamily = Platform.select({
  ios: 'Avenir Next',
  android: 'sans-serif',
  default: 'sans-serif',
}) ?? 'sans-serif';

const monoFamily = Platform.select({
  ios: 'SFMono-Regular',
  android: 'monospace',
  default: 'monospace',
}) ?? 'monospace';

export const colors = {
  canvas: '#050505',
  surface: '#10100F',
  surfaceRaised: '#1A1915',
  /** A hair above `surface`, for a control resting on a card. */
  surfaceSunken: '#0A0908',
  white: '#FFFFFF',
  ink: '#FFFFFF',
  inkMuted: '#B8B4AA',
  /** For the quietest text: timestamps, units, helper lines. */
  inkFaint: '#7D786D',
  line: '#38342C',
  /** A border that should be felt rather than seen. */
  lineSoft: '#25231E',
  /*
   * The gold is the card's gold. It used to be #FFB000 — a saturated
   * orange-yellow that is one flat hue, and beside a marbled metal card it read
   * as a highlighter next to jewellery. These are lifted from the card's own
   * gradient: champagne for a fill, a paler edge for anything meant to catch
   * the light, and a deep brown for a tint that has to sit under text.
   *
   * `gold` stays light enough to carry black type, because it fills buttons.
   */
  gold: '#E0B45D',
  goldBright: '#F5D182',
  goldPale: '#FFE8B0',
  goldDeep: '#8A5E10',
  goldMid: '#C68C22',
  goldSoft: '#2C2008',
  lemon: '#E0B45D',
  lemonBright: '#F5D182',
  lemonSoft: '#2C2008',
  /** Compatibility aliases while feature code moves off the old amber. */
  amber: '#E0B45D',
  amberDark: '#C68C22',
  amberSoft: '#2C2008',
  // Positive state is still semantic, but it stays inside the brand palette.
  success: '#F5D182',
  successSoft: '#2C2008',
  danger: '#FF7272',
  dangerSoft: '#351517',
  black: '#050505',
} as const;

export const spacing = {xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, huge: 48} as const;

/**
 * Corners are generous on purpose. A 4pt radius reads as a desktop form from a
 * decade ago; phones have been soft-cornered for years and a payment app that
 * looks dated is a payment app people hesitate over.
 */
export const radius = {xs: 8, sm: 12, md: 18, lg: 24, xl: 32, round: 999} as const;

export const typography = {
  display: {fontFamily: sansFamily, fontSize: 36, lineHeight: 42, fontWeight: '700' as const, letterSpacing: 0},
  title: {fontFamily: sansFamily, fontSize: 22, lineHeight: 28, fontWeight: '700' as const, letterSpacing: 0},
  body: {fontFamily: sansFamily, fontSize: 16, lineHeight: 24, fontWeight: '400' as const},
  label: {fontFamily: sansFamily, fontSize: 13, lineHeight: 18, fontWeight: '600' as const},
  /** Small all-caps section headers. */
  overline: {fontFamily: sansFamily, fontSize: 11, lineHeight: 14, fontWeight: '700' as const, letterSpacing: 1.1},
  mono: {fontFamily: monoFamily, fontSize: 13, lineHeight: 18},
} as const;

/**
 * Depth is carried by shadow on iOS and elevation on Android, so a raised
 * surface reads the same on both without either platform faking the other.
 */
export const elevation = {
  card: {
    shadowColor: '#000000',
    shadowOffset: {width: 0, height: 8},
    shadowOpacity: 0.28,
    shadowRadius: 20,
    elevation: 6,
  },
  raised: {
    shadowColor: '#000000',
    shadowOffset: {width: 0, height: 14},
    shadowOpacity: 0.36,
    shadowRadius: 30,
    elevation: 12,
  },
} as const;
