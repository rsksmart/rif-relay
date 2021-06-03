module.exports = {
  env: {
    browser: true,
    es6: true,
    jest: true,
    mocha: true,
    node: true
  },
  globals: {
    artifacts: false,
    assert: false,
    contract: false,
    web3: false,
    ethers: false
  },
  plugins: [
    '@typescript-eslint',
    'security'
  ],
  extends: [
    'standard-with-typescript',
    'plugin:security/recommended'
  ],
  rules: {
    'no-console': 'off'
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    // The 'tsconfig.eslint.json' is needed to add all JavaScript files to the project
    project: ['./tsconfig.json', './tsconfig.eslint.json']
  },
  ignorePatterns: [
    'rsknode/'
  ],
  overrides: [
    {
      files: [
        './test/**/*.ts'
      ],
      rules: {
        'no-unused-expressions': 'off',
        // chai assertions trigger this rule
        '@typescript-eslint/no-unused-expressions': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off'
      }
    },
    {
      // otherwise it will raise an error in every JavaScript file
      files: ['*.ts'],
      rules: {
        '@typescript-eslint/prefer-ts-expect-error': 'off',
        // allow using '${val}' with numbers, bool and null types
        '@typescript-eslint/restrict-template-expressions': [
          'error',
          {
            allowNumber: true,
            allowBoolean: true,
            allowNullish: true,
            allowNullable: true
          }
        ]
      }
    }
  ]
}
