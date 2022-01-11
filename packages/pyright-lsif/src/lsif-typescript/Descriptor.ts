enum DescriptorKind {
  Package,
  Type,
  Term,
  Meta,
  Method,
  Parameter,
  TypeParameter,
}

export class Descriptor {
  private constructor(
    public readonly name: string,
    public readonly kind: DescriptorKind,
    public readonly disambiguator?: string
  ) {}
  public static package(name: string): Descriptor {
    return new Descriptor(name, DescriptorKind.Package)
  }
  public static type(name: string): Descriptor {
    return new Descriptor(name, DescriptorKind.Type)
  }
  public static term(name: string): Descriptor {
    return new Descriptor(name, DescriptorKind.Term)
  }
  public static meta(name: string): Descriptor {
    return new Descriptor(name, DescriptorKind.Meta)
  }
  public static method(name: string, disambiguator: string): Descriptor {
    return new Descriptor(name, DescriptorKind.Method, disambiguator)
  }
  public static parameter(name: string): Descriptor {
    return new Descriptor(name, DescriptorKind.Parameter)
  }
  public static typeParameter(name: string): Descriptor {
    return new Descriptor(name, DescriptorKind.TypeParameter)
  }
  public syntax(): string {
    switch (this.kind) {
      case DescriptorKind.Package:
        return this.nameSyntax() + '/'
      case DescriptorKind.Type:
        return this.nameSyntax() + '#'
      case DescriptorKind.Term:
        return this.nameSyntax() + '.'
      case DescriptorKind.Meta:
        return this.nameSyntax() + ':'
      case DescriptorKind.Method:
        return this.nameSyntax() + '(' + (this.disambiguator || '') + ').'
      case DescriptorKind.Parameter:
        return '(' + this.nameSyntax() + ')'
      case DescriptorKind.TypeParameter:
        return '[' + this.nameSyntax() + ']'
      default:
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        throw new Error(`unknown descriptor kind: ${this.kind}`)
    }
  }
  private nameSyntax(): string {
    return this.name
  }
}
