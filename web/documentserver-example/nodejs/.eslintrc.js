module.exports = {
  env: {
    browser: true,
    commonjs: true,
    es2021: true,
  },
  extends: ['airbnb-base'],
  overrides: [
  ],
  parserOptions: {
    ecmaVersion: 'latest',
  },
  rules: {
    'max-len': ['error', { code: 120 }],
    'no-restricted-syntax': ['error', 'WithStatement', 'BinaryExpression[operator="in"]'],
    'no-console': 'off',
    'no-continue': 'off',
    'no-extend-native': ['error', { exceptions: ['String'] }],
    radix: ['error', 'as-needed'],
  },
};
