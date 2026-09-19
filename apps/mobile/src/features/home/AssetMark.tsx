import Svg, {Circle, Path, Text as SvgText} from 'react-native-svg';

export type AssetMarkProps = {code: string; size?: number};

/**
 * Stellar's mark and Circle's, traced from the logo files rather than drawn by
 * eye. Both are given in a 24-unit box.
 */
const STELLAR =
  'M11.59 1.85L9.94 2.05L9.15 2.25L7.41 2.94L6.47 3.48L5.58 4.12L4.74 4.9L3.95 5.8L2.91 7.45L2.27 9.05L2.07 9.8L1.88 11.1L1.88 13.19L1.73 13.69L1.22 14.35L0.0 15.0L0.0 17.05L24.0 4.85L24.0 2.81L23.87 2.84L3.75 13.06L3.69 11.78L3.79 10.64L4.02 9.62L4.43 8.53L4.99 7.51L5.65 6.63L6.6 5.67L7.54 4.98L9.14 4.19L10.86 3.76L12.38 3.7L13.38 3.79L14.91 4.21L16.05 4.75L17.93 3.81L17.53 3.48L16.49 2.89L14.85 2.25L13.3 1.93ZM23.97 6.94L0.0 19.14L0.0 21.19L20.18 10.92L20.25 10.92L20.31 11.86L20.25 13.11L19.98 14.36L19.56 15.5L19.06 16.4L18.32 17.41L17.43 18.3L16.51 18.99L15.46 19.56L14.67 19.88L13.63 20.16L12.84 20.27L11.65 20.3L10.21 20.12L9.0 19.76L7.95 19.23L6.06 20.19L7.13 20.91L8.56 21.56L9.96 21.95L11.57 22.15L13.28 22.07L14.83 21.75L16.07 21.31L17.15 20.75L18.47 19.83L19.52 18.82L20.31 17.84L21.09 16.55L21.53 15.53L21.93 14.2L22.12 12.88L22.12 10.77L22.21 10.46L22.47 9.97L22.83 9.6L24.0 9.0Z';

const USDC_WHITE =
  'M9.75 3.3L8.67 3.63L7.11 4.44L5.97 5.31L4.95 6.39L4.11 7.65L3.51 9.0L3.15 10.32L3.0 11.82L3.15 13.68L3.51 15.0L4.23 16.56L4.95 17.61L5.97 18.69L7.11 19.56L8.67 20.37L9.72 20.7L9.81 20.67L9.81 19.23L8.55 18.72L7.26 17.88L6.15 16.77L5.52 15.87L5.04 14.94L4.68 13.83L4.47 12.36L4.47 11.67L4.56 10.71L4.8 9.72L5.16 8.82L5.64 7.95L6.36 6.99L7.59 5.88L8.55 5.28L9.81 4.77ZM14.25 3.3L14.19 4.77L15.45 5.28L16.77 6.15L17.64 6.99L18.6 8.34L18.96 9.06L19.32 10.17L19.53 11.64L19.53 12.33L19.44 13.29L19.2 14.28L18.84 15.18L18.36 16.05L17.64 17.01L16.53 18.03L15.45 18.72L14.19 19.23L14.22 20.7L15.33 20.37L16.89 19.56L18.03 18.69L19.05 17.61L19.89 16.35L20.49 15.0L20.85 13.68L21.0 12.18L20.85 10.32L20.49 9.0L19.77 7.44L19.05 6.39L18.03 5.31L16.89 4.44L15.33 3.63ZM11.37 6.75L11.28 6.81L11.28 7.89L10.53 8.07L9.99 8.31L9.51 8.67L9.18 9.12L8.94 9.9L9.03 10.92L9.36 11.49L10.14 12.09L11.13 12.45L12.84 12.84L13.41 13.11L13.65 13.35L13.77 13.65L13.68 14.16L13.38 14.52L13.11 14.67L12.3 14.85L11.88 14.85L11.28 14.76L10.71 14.49L10.35 14.07L10.11 13.44L8.7 13.44L8.67 13.59L8.91 14.49L9.39 15.21L10.11 15.72L11.28 16.11L11.34 17.25L12.66 17.25L12.72 16.11L14.04 15.69L14.85 14.97L15.09 14.49L15.21 13.95L15.12 12.96L14.76 12.33L13.95 11.76L12.42 11.31L11.52 11.16L10.74 10.83L10.44 10.5L10.44 9.81L10.71 9.45L11.1 9.24L12.18 9.15L12.6 9.24L12.96 9.45L13.32 9.87L13.44 10.38L13.53 10.44L14.94 10.41L14.94 10.26L14.73 9.45L14.28 8.76L13.74 8.31L12.72 7.92L12.66 6.75Z';

/**
 * The badge beside a balance row.
 *
 * Stellar and USDC carry their own marks, because a payment screen naming an
 * asset should show the mark its holder already recognises. Anything else gets
 * a coloured disc carrying its ticker rather than an approximation of somebody
 * else's logo — a wrong logo on a payment screen is worse than an honest label.
 */
export function AssetMark({code, size = 34}: AssetMarkProps) {
  const upper = code.toUpperCase();

  if (upper === 'XLM') {
    // The bars of the mark run edge to edge, so it is inset to sit on the disc.
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Circle cx={12} cy={12} r={12} fill="#0F0F12" />
        <Path d={STELLAR} fill="#FFFFFF" fillRule="evenodd" transform="translate(3.6 3.6) scale(0.7)" />
      </Svg>
    );
  }

  if (upper === 'USDC') {
    // Circle's mark is already a disc, so it needs no plate under it.
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Circle cx={12} cy={12} r={12} fill="#0B53BF" />
        <Path d={USDC_WHITE} fill="#FFFFFF" fillRule="evenodd" />
      </Svg>
    );
  }

  return (
    <Svg width={size} height={size} viewBox="0 0 40 40">
      <Circle cx={20} cy={20} r={20} fill="#3A3A34" />
      <SvgText
        x={20}
        y={24}
        fill="#FFFFFF"
        fontSize={upper.length > 4 ? 9 : 11}
        fontWeight="700"
        textAnchor="middle">
        {upper.slice(0, 5)}
      </SvgText>
    </Svg>
  );
}
