import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'node_modules/',
      '**/node_modules/',
      'dist/',
      '**/dist/',
      'build/',
      'coverage/',
      '**/coverage/',
      '**/*.min.js',
      'specs/',
      '.specify/',
      // Generated from contracts/openapi.yaml by npm run generate:api.
      'packages/shared/src/api-schema.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // A leading underscore marks a parameter that exists only for its type or position.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Plain Node scripts run by npm test (boundary and contract-drift checks).
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
);
