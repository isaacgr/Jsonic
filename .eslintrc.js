module.exports = {
  env: {
    commonjs: true,
    es6: true,
    node: true,
    mocha: true
  },
  extends: ["airbnb-base"],
  globals: {
    Atomics: "readonly",
    SharedArrayBuffer: "readonly"
  },
  parserOptions: {
    ecmaVersion: 2018
  },
  rules: {
    "new-cap": "off",
    "class-methods-use-this": "off",
    "comma-dangle": "off",
    quotes: ["error", "double"],
    "no-restricted-syntax": [
      "off",
      {
        selector: "ForOfStatement"
      }
    ]
  }
};