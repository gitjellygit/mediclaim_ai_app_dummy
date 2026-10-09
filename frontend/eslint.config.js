const browserGlobals = {
  console: "readonly",
  window: "readonly",
  document: "readonly",
  localStorage: "readonly",
  fetch: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  FormData: "readonly",
  Blob: "readonly",
  File: "readonly",
  FileReader: "readonly",
  Event: "readonly",
  KeyboardEvent: "readonly",
  Headers: "readonly",
  Response: "readonly",
  btoa: "readonly"
};

export default [
  {
    ignores: ["node_modules/**", "dist/**", "playwright-report/**", "test-results/**"]
  },
  {
    files: ["src/**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: true }
      },
      globals: browserGlobals
    },
    rules: {
      "no-undef": "error",
      "no-unreachable": "error",
      "no-constant-binary-expression": "error"
    }
  },
  {
    files: ["tests/**/*.js", "playwright.config.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...browserGlobals,
        process: "readonly",
        Buffer: "readonly"
      }
    },
    rules: {
      "no-undef": "error",
      "no-unreachable": "error",
      "no-constant-binary-expression": "error"
    }
  }
];
