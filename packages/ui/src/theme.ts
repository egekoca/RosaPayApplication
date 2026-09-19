export const colors = {
  canvas: '#080F14',
  surface: '#111A20',
  surfaceRaised: '#18242B',
  ink: '#F5EFE5',
  inkMuted: '#9AA5A8',
  line: '#2A373D',
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

export const spacing = {xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32} as const;
export const radius = {sm: 4, md: 8, round: 999} as const;
export const typography = {
  display: {fontSize: 34, lineHeight: 40, fontWeight: '700' as const},
  title: {fontSize: 22, lineHeight: 28, fontWeight: '700' as const},
  body: {fontSize: 16, lineHeight: 23, fontWeight: '400' as const},
  label: {fontSize: 13, lineHeight: 18, fontWeight: '600' as const},
  mono: {fontSize: 13, lineHeight: 18, fontFamily: 'Courier'},
} as const;
