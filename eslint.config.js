const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/**', 'dist/**', 'coverage/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      eqeqeq: ['error', 'smart'],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },
  {
    files: ['src/renderer/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser, module: 'readonly' },
    },
    rules: {
      // Model output must never be parsed as HTML in the renderer.
      'no-restricted-properties': ['error',
        { property: 'innerHTML', message: 'Build DOM nodes instead — see markdown.js.' },
        { property: 'outerHTML', message: 'Build DOM nodes instead.' },
      ],
      'no-restricted-syntax': ['error',
        { selector: "CallExpression[callee.property.name='insertAdjacentHTML']", message: 'Build DOM nodes instead.' },
      ],
    },
  },
  {
    files: ['test/**/*.js'],
    languageOptions: { sourceType: 'module' },
  },
];
