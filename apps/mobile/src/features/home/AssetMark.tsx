import Svg, {Circle, G, Path, Text as SvgText} from 'react-native-svg';

export type AssetMarkProps = {code: string; size?: number};

/**
 * The badge beside a balance row.
 *
 * Stellar's mark is drawn because its geometry is simple and unambiguous.
 * Everything else gets a coloured disc carrying its own ticker rather than an
 * approximation of somebody's logo — a wrong logo on a payment screen is worse
 * than an honest label.
 */
export function AssetMark({code, size = 34}: AssetMarkProps) {
  const upper = code.toUpperCase();

  if (upper === 'XLM') {
    return (
      <Svg width={size} height={size} viewBox="0 0 40 40">
        <Circle cx={20} cy={20} r={20} fill="#0F0F12" />
        <G stroke="#FFFFFF" strokeWidth={2.1} strokeLinecap="round" fill="none">
          <Path d="M9 14.4 31 25.6" />
          <Path d="M31 14.4 9 25.6" opacity={0} />
        </G>
        <G fill="none" stroke="#FFFFFF" strokeWidth={2.1} strokeLinecap="round">
          <Path d="M10.5 25.8c-.6-1.7-.7-3.6-.2-5.4 1.4-5.2 6.8-8.3 12-6.9" />
          <Path d="M29.5 14.2c.6 1.7.7 3.6.2 5.4-1.4 5.2-6.8 8.3-12 6.9" />
        </G>
      </Svg>
    );
  }

  const tone = upper === 'USDC' ? '#2775CA' : '#3A3A34';
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40">
      <Circle cx={20} cy={20} r={20} fill={tone} />
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
