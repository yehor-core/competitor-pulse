export default {
  '*.{ts,tsx,js}': ['eslint --fix', 'prettier --write'],
  '*.{json,md,yml,yaml,html,css}': 'prettier --write',
  // Typecheck is whole-project on purpose: a staged file can break an unstaged one.
  'backend/**/*.ts': (files) => [
    'npm run typecheck -w backend',
    `npm exec -w backend -- vitest related --run --passWithNoTests ${files.join(' ')}`,
  ],
  'frontend/**/*.{ts,tsx}': () => 'npm run typecheck -w frontend',
};
