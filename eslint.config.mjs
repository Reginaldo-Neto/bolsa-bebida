import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/generated/**',
      'research/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      // `x == null` is the idiomatic "null or undefined" check and is exactly
      // what Prisma's nullable columns need; everything else must be strict.
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
  {
    // NestJS resolves injected dependencies from the metadata emitted by
    // `emitDecoratorMetadata`, which only sees value imports. Rewriting an
    // injected class to `import type` erases it and breaks DI at runtime.
    files: ['apps/api/**/*.ts', 'apps/worker/**/*.ts', 'packages/core/**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
  {
    // Stale closures and missing dependencies are real bugs in a screen that
    // updates from a socket, not style opinions.
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts', '**/*.config.ts', '**/scripts/**/*.ts', '**/seed.ts'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
