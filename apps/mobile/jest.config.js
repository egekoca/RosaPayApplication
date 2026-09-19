module.exports = {
  preset: '@react-native/jest-preset',
  // Everything under __tests__ is a suite by default, so shared fixtures need
  // saying otherwise or jest reports them as suites containing no tests.
  testMatch: ['**/__tests__/**/*.test.[jt]s?(x)'],
  transform: {
    '^.+\\.(js|mjs|ts|tsx)$': 'babel-jest',
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-navigation|react-native(-.*)?|lucide-react-native|@tanstack|@noble|@scure|@stellar|uint8array-extras|js-base64|standard-navigation|use-latest-callback)/)',
  ],
};
