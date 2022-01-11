export class Position {
  constructor(
    public readonly line: number,
    public readonly character: number
  ) {}
  public compare(other: Position): number {
    if (this.line !== other.line) {
      return this.line - other.line
    }
    return this.character - other.character
  }
}
