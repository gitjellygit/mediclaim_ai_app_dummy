export default [
  {
    ignores: ["node_modules/**", "coverage/**", "prisma/migrations/**"]
  },
  {
    files: ["src/**/*.js", "tests/**/*.js", "prisma/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        AbortSignal: "readonly",
        fetch: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly"
      }
    },
    rules: {
      "no-undef": "error",
      "no-unreachable": "error",
      "no-constant-binary-expression": "error"
    }
  }
];
