export default [
  {
    ignores: ["node_modules/**", "dist/**", "playwright-report/**", "test-results/**"]
  },
  {
    files: ["src/**/*.{js,jsx}", "tests/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: true }
      },
      globals: {
        console: "readonly",
        window: "readonly",
        document: "readonly",
        localStorage: "readonly",
        fetch: "readonly",
        URL: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        FormData: "readonly",
        Blob: "readonly",
        File: "readonly",
        FileReader: "readonly",
        Event: "readonly",
        KeyboardEvent: "readonly"
      }
    },
    rules: {
      "no-undef": "error",
      "no-unreachable": "error",
      "no-constant-binary-expression": "error"
    }
  }
];
