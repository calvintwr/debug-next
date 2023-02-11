/* eslint-disable @typescript-eslint/no-var-requires */
const { pathsToModuleNameMapper } = require('ts-jest')
const { compilerOptions } = require('require-json5')('./tsconfig.json')

module.exports = {
    rootDir: '.',
    roots: ['src'],

    // match ts files only
    transform: {
        '^.+\\.ts$': 'ts-jest',
    },

    // coverageReporters: ['json'],
    coverageDirectory: '../coverage',
    collectCoverageFrom: ['**/*.(t|j)s'],
    coveragePathIgnorePatterns: [
        'dist',
        'node_modules',
        '.test.ts$',
        '.setup.ts$',
        '__mocks__',
    ],

    testRegex: '.*\\.test\\.ts$',
    testEnvironment: 'node',

    moduleFileExtensions: ['js', 'json', 'ts'],
    moduleDirectories: ['node_modules', '<rootDir>/src'],
}
