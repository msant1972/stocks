import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.browser }, parserOptions: { ecmaFeatures: { jsx: true } } },
    settings: { react: { version: 'detect' } },
    rules: {
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }],
    },
  },
  {
    files: ['test/**/*.js', 'vite.config.js', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node } },
  },
];
