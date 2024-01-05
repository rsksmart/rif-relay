module.exports = {
  extends: [
    "eslint:recommended",
    "plugin:mocha/recommended",
    "plugin:@typescript-eslint/eslint-recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking",
    "prettier",
  ],
  env: {
    browser: false,
    es2021: true,
    mocha: true,
    node: true,
  },
  // root: true,
  plugins: ["@typescript-eslint", "mocha"],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    tsconfigRootDir: __dirname,
    project: "./tsconfig.json",
  },
  rules: {
    "lines-between-class-members": "error",
    "padding-line-between-statements": [
      "error",
      { blankLine: "always", prev: "*", next: "return" },
    ],
    "prefer-const": [
      "error",
      {
        destructuring: "any",
        ignoreReadBeforeAssign: false,
      },
    ],
    "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    "@typescript-eslint/naming-convention": [
      "error",
      {
        selector: ["variable", "function"],
        format: ["camelCase"],
      },
      {
        selector: ["variable"],
        modifiers: ["const"],
        format: ["camelCase", "UPPER_CASE"],
      },
    ],
    "mocha/no-skipped-tests": "warn",
    "mocha/no-empty-description": "off",
    "mocha/no-exclusive-tests": "error",
    "@typescript-eslint/no-unsafe-member-access": "warn",
    "eol-last": ["error", "always"]
  },
};
