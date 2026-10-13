import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { window: 'readonly', document: 'readonly', HTMLElement: 'readonly', HTMLInputElement: 'readonly', HTMLSelectElement: 'readonly', Event: 'readonly' } } }
);
