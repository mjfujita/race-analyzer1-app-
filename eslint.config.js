import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import hooks from 'eslint-plugin-react-hooks'

export default [
  { ignores: ['dist/**', 'node_modules/**', 'pipeline/**', 'test-results/**', 'playwright-report/**'] },
  { files: ['src/{automaticResultGroups,groupRegistration,predictionJournal,racePredictionResults,usePredictionJournal,deviceAuth,useDeviceSession,horseAssessment,aceAssessment,groupProbabilities,groupDisplay,groupAnalysis,personalGroupPrediction,marketModel,portfolio,raceTime,oddsHistory,paceHistory,modelStore,fileIO,forecastLedger,predictionModel,cloudStore,useCompanion,useRaceCatalog,useAceAssessment,useRaceProgress,raceProgress,forecastReview,workspaceSettings,workspaceReview}.js', 'src/{RaceGroupTrends,RegisteredGroupSummary,PredictionJournalPanel,RacePredictionResultsList,RaceResultsWorkspace,RaceCatalogList,RaceOverview,CaptureControls,DeviceManager,HorseAssessments,PaddockInformation,AceHorseAssessment,GroupWorkspace,GroupPredictionCard,GroupProbabilitySummary,GroupSelectionNumbers,GroupHorsePrediction,PersonalGroupComposer,GroupReviewSection,AbilityPage,PacePage,WinOddsPage,FinalForecastPage,RaceDataPanel,AutomationPanel,RuntimeModelPanel,ForecastReviewPage,WorkspaceShell,DisplaySettings,DataManagement,ReviewWorkspace,OddsMomentumPanel,AnchorAssessmentPanel,RaceDayDashboard}.jsx', 'dev/**/*.{js,jsx}', 'tests/**/*.js', 'server/**/*.js', 'api/**/*.js'],
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
