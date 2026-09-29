// Web-specific ESLint config (flat config). Наследует корневой (парсер и правила
// typescript-eslint) и добавляет Next.js / React / react-hooks.
// Using @next/eslint-plugin-next directly to avoid @rushstack/eslint-patch ESLint 10 incompatibility
//
// `files` обязателен: ESLint 9 без шаблона проверяет только .js/.mjs/.cjs, и
// .ts/.tsx по прямому пути считались «ignored» (а next lint молча их пропускал).
import nextPlugin from '@next/eslint-plugin-next';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import rootConfig from '../../eslint.config.mjs';

export default [
  // next-env.d.ts генерирует Next; public/ — статика (AudioWorklet со своими глобалами).
  { ignores: ['next-env.d.ts', 'public/**'] },
  ...rootConfig,
  {
    files: ['**/*.{js,jsx,mjs,cjs,ts,tsx}'],
    plugins: {
      '@next/next': nextPlugin,
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      ...reactHooksPlugin.configs.recommended.rules,
    },
    settings: {
      react: { version: 'detect' },
    },
  },
  // Тесты: моки jest через require() и any — норма.
  {
    files: ['tests/**/*.{ts,tsx}', 'jest.setup.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
];
