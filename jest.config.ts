import type { Config } from '@jest/types';

const config: Config.InitialOptions = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  setupFiles: ['<rootDir>/test/pre-setup.ts'],
  setupFilesAfterEnv: ['<rootDir>/test/jest.setup.ts'],
};

export default config;
