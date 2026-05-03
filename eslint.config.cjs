const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  {
    ignores: [
      "**/node_modules/**",
      "assets/**",
      "test_files/**",
      "public/images/**",
      "public/js/vendor/**",
    ],
  },
  {
    files: ["server/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: globals.node,
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["public/js/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: {
        ...globals.browser,
        ...globals.es2021,
        io: "readonly",
        QRCode: "readonly",
        JSZip: "readonly",
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-undef": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-useless-assignment": "warn",
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          caughtErrors: "none",
        },
      ],
      "prefer-const": "warn",
      eqeqeq: ["warn", "always"],
    },
  },
  {
    files: ["public/js/config/constants.js"],
    rules: {
      "no-unused-vars": "off",
    },
  },
  {
    files: ["test/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: globals.node,
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
];
