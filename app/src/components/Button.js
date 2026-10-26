import { Pressable, Text, StyleSheet } from 'react-native';
import { C } from '../theme.js';

// The site's .btn: primary (gold), secondary (outlined), online (blue), danger.
export default function Button({ title, onPress, variant = 'secondary', disabled, small, style, accessibilityLabel }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      style={({ pressed }) => [styles.base, small && styles.small, styles[variant], pressed && styles.pressed, disabled && styles.disabled, style]}
    >
      <Text style={[styles.text, small && styles.smallText, variant === 'primary' && styles.primaryText]} numberOfLines={1}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  small: { paddingVertical: 8, paddingHorizontal: 12 },
  primary: { backgroundColor: C.gold, borderColor: C.goldStrong },
  secondary: { backgroundColor: C.bg2, borderColor: C.lineStrong },
  online: { backgroundColor: '#1d3a73', borderColor: '#3a63b8' },
  danger: { backgroundColor: '#3a1a22', borderColor: '#7a2e3a' },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.45 },
  text: { color: C.textBright, fontSize: 15, fontWeight: '700' },
  smallText: { fontSize: 13 },
  primaryText: { color: '#1b1405' },
});
