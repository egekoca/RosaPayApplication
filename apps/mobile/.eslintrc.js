module.exports = {
  root: true,
  extends: '@react-native',
  rules: {
    // Fire-and-forget native/UI effects are explicitly marked with `void` and
    // handle their own errors where the result matters.
    'no-void': 'off',
  },
};
