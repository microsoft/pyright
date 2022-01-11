import { Descriptor } from './Descriptor'

export class LsifSymbol {
  protected constructor(public readonly value: string) {}
  public isEmpty(): boolean {
    return this.value === ''
  }
  public isLocal(): boolean {
    return this.value.startsWith('local ')
  }
  public isEmptyOrLocal(): boolean {
    return this.isEmpty() || this.isLocal()
  }

  public static local(counter: number): LsifSymbol {
    return new LsifSymbol(`local ${counter}`)
  }
  public static empty(): LsifSymbol {
    return new LsifSymbol('')
  }
  public static sourceFile(
    package_: LsifSymbol,
    relativePath: string[]
  ): LsifSymbol {
    let symbol = package_
    for (const part of relativePath) {
      symbol = LsifSymbol.global(symbol, Descriptor.package(part))
    }
    return symbol
  }
  public static package(name: string, version: string): LsifSymbol {
    return new LsifSymbol(`lsif-node npm ${name} ${version} `)
  }
  public static global(owner: LsifSymbol, descriptor: Descriptor): LsifSymbol {
    return new LsifSymbol(owner.value + descriptor.syntax())
  }
}
