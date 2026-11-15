import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import hooks from 'eslint-plugin-react-hooks'

export default [
  { ignores: ['dist/**', 'node_modules/**', 'pipeline/**', 'test-results/**', 'playwright-report/**'] },
  { files: ['src/{marketModel,portfolio,raceTime,oddsHistory,paceHistory,modelStore,fileIO,forecastLedger}.js', 'src/{AbilityPage,PacePage,WinOddsPage,FinalForecastPage,RaceDataPanel}.jsx', 'dev/**/*.{js,jsx}', 'tests/**/*.js'],
    ...js.configs.recommended,
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } }, globals: { ...globals.browser, ...globals.node } },
    plugins: { react, 'react-hooks': hooks },
    settings: { react: { version: '19.2' } },
    rules: { ...js.configs.recommended.rules, 'react/jsx-uses-vars': 'error', 'react/jsx-uses-react': 'error',
      'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'warn',
      'no-irregular-whitespace': ['error', { skipStrings: true, skipComments: true, skipTemplates: true, skipJSXText: true }],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }] },
  },
]
