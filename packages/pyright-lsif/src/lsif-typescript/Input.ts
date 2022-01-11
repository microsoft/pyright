import * as fs from 'fs'

import { Range } from './Range'

export class Input {
  public lines: string[]
  constructor(public readonly path: string, public readonly text: string) {
    this.lines = text.split('\n')
  }

  public static fromFile(path: string): Input {
    // eslint-disable-next-line no-sync
    return new Input(path, fs.readFileSync(path).toString())
  }
  public format(range: Range, diagnostic?: string): string {
    const line = this.lines[range.start.line]
    const indent = ' '.repeat(range.start.character)
    const length = range.isSingleLine()
      ? range.end.character - range.start.character
      : line.length - range.start.character
    const carets = length < 0 ? '<negative length>' : '^'.repeat(length)
    const multilineSuffix = !range.isSingleLine()
      ? ` ${range.end.line}:${range.end.character}`
      : ''
    const message = diagnostic ? ' ' + diagnostic : ''
    return `${this.path}:${range.start.line}:${range.start.character}${message}\n${line}\n${indent}${carets}${multilineSuffix}`
  }
  public log(range: Range): void {
    console.log(this.format(range))
  }
}
