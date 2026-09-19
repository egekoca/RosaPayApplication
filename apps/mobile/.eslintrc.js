module.exports = {
  root: true,
  extends: '@react-native',
  rules: {
    // Fire-and-forget native/UI effects are explicitly marked with `void` and
    // handle their own errors where the result matters.
    'no-void': 'off',
    // `const {email: _email, ...rest} = profile` is how a key is dropped, and
    // the named half is meant to go unused. Allowing it by the underscore this
    // codebase already writes keeps that idiom from needing a suppression
    // comment every time, without hiding a genuinely forgotten variable.
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        args: 'after-used',
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      },
    ],
  },
};
