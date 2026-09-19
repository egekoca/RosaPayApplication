import {StyleSheet} from 'react-native';
import Svg, {Defs, LinearGradient, Rect, Stop} from 'react-native-svg';

/**
 * The card's gold, as a fill for anything else that should look like it is
 * made of the same material.
 *
 * Deliberately shallow. The balance card can afford a full metal gradient
 * because it is the one object on the screen; a button repeating that would
 * turn a control into an ornament. This is just enough that a large gold
 * surface is not dead flat — the difference between paint and anodising.
 */
export function GoldFill({radius}: {radius?: number}) {
  return (
    <Svg
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, radius === undefined ? null : {borderRadius: radius}]}
      // Sized by the style alone. Passing width/height props as well gives the
      // canvas a second source of truth, and the props resolve against the
      // wrong box — which left a seam short of the container's right edge.
      viewBox="0 0 100 40"
      preserveAspectRatio="none">
      <Defs>
        <LinearGradient id="goldFill" x1="0" y1="0" x2="0.35" y2="1">
          <Stop offset="0" stopColor="#F0C778" />
          <Stop offset="0.5" stopColor="#DFB157" />
          <Stop offset="1" stopColor="#C8993E" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100" height="40" fill="url(#goldFill)" />
    </Svg>
  );
}
