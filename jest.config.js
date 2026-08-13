/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",

  testMatch: ["**/src/**/?(*.)+(spec|test).[jt]s?(x)"],

  testPathIgnorePatterns: ["/node_modules/", "/dist/"],

  verbose: true,
};
