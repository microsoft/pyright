export class Counter {
  private n = -1
  public next(): number {
    this.n++
    return this.n
  }
}
