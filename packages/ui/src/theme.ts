export const colors = {
  canvas: '#080F14',
  surface: '#111A20',
  surfaceRaised: '#18242B',
  /** A hair above `surface`, for a control resting on a card. */
  surfaceSunken: '#0D151A',
  ink: '#F5EFE5',
  inkMuted: '#9AA5A8',
  /** For the quietest text: timestamps, units, helper lines. */
  inkFaint: '#6B787C',
  line: '#2A373D',
  /** A border that should be felt rather than seen. */
  lineSoft: '#1C282E',
  rose: '#D56A78',
  roseDark: '#F09A87',
  roseSoft: '#2A1B24',
  amber: '#E8AD42',
  amberDark: '#D9962E',
  amberSoft: '#332713',
  success: '#55C77C',
  successSoft: '#153727',
  danger: '#F07878',
  dangerSoft: '#3A1D23',
  black: '#05090C',
} as const;

export const spacing = {xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, huge: 48} as const;

/**
 * Corners are generous on purpose. A 4pt radius reads as a desktop form from a
 * decade ago; phones have been soft-cornered for years and a payment app that
 * looks dated is a payment app people hesitate over.
 */
export const radius = {xs: 8, sm: 12, md: 18, lg: 24, xl: 32, round: 999} as const;

export const typography = {
  display: {fontSize: 36, lineHeight: 42, fontWeight: '700' as const, letterSpacing: -0.8},
  title: {fontSize: 22, lineHeight: 28, fontWeight: '700' as const, letterSpacing: -0.3},
  body: {fontSize: 16, lineHeight: 24, fontWeight: '400' as const},
  label: {fontSize: 13, lineHeight: 18, fontWeight: '600' as const},
  /** Small all-caps section headers. */
  overline: {fontSize: 11, lineHeight: 14, fontWeight: '700' as const, letterSpacing: 1.1},
  mono: {fontSize: 13, lineHeight: 18, fontFamily: 'Courier'},
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
