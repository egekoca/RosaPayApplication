module.exports = {
  preset: '@react-native/jest-preset',
  transform: {
    '^.+\\.(js|mjs|ts|tsx)$': 'babel-jest',
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-navigation|react-native(-.*)?|lucide-react-native|@tanstack|@noble|js-base64|standard-navigation|use-latest-callback)/)',
  ],
};
