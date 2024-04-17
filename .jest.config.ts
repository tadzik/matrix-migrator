import type {Config} from 'jest';

const config: Config = {
  clearMocks: true,
  collectCoverage: true,
  coverageDirectory: "coverage",
  coverageProvider: "v8",
  preset: 'ts-jest',

  coverageReporters: [
    "text",
    "html",
  ],
};

export default config;
