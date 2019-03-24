/*
* jest.config.js
*
* Configuration for jest tests.
*/

module.exports = {
  'roots': [
    '<rootDir>/src'
  ],
  'transform': {
    '^.+\\.tsx?$': 'ts-jest'
  },
  'testRegex': '(/__tests__/.*|(\\.|/)(test|spec))\\.tsx?$',
  'moduleFileExtensions': [
    'ts',
    'tsx',
    'js',
    'jsx'
  ]
}

