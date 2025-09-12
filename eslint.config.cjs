// Flat config for ESLint v9+ (CommonJS)
const js = require('@eslint/js');
const pluginReact = require('eslint-plugin-react');
const pluginImport = require('eslint-plugin-import');
const pluginReactHooks = require('eslint-plugin-react-hooks');
const globals = require('globals');

module.exports = [
  js.configs.recommended,
  {
    ignores: [
      '.meteor/**',
      'node_modules/**',
      'dist/**',
      'build/**',
      'eslint.config.cjs',
      '.eslintrc.json'
    ],
    files: ["**/*.js", "**/*.jsx"],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'module',
      globals: { ...globals.browser, Meteor: 'readonly' },
      parserOptions: { ecmaFeatures: { jsx: true } }
    },
    plugins: {
      react: pluginReact,
      import: pluginImport,
      'react-hooks': pluginReactHooks
    },
    settings: {
      react: { version: 'detect' },
      'import/resolver': { meteor: {} }
    },
    rules: {
      'import/no-absolute-path': 'off'
    }
  },
  // Node/server files (Meteor server, Electron)
  {
    files: [ 'electron/**/*.js' ],
    languageOptions: { globals: { ...globals.node } }
  },
  {
    files: [ 'server/**/*.js', 'imports/api/**/*.js' ],
    languageOptions: { globals: { ...globals.node } }
  },
  // Tests (mocha)
  {
    files: [
      '**/*.test.js',
      'tests/**/*.js',
      'imports/api/**/__tests__/**/*.js'
    ],
    languageOptions: {
      globals: { ...globals.mocha, ...globals.node }
    }
  }
];


