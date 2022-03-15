import * as lsif from '../lsif'

type Descriptor = lsif.lib.codeintel.lsiftyped.Descriptor
const Descriptor = lsif.lib.codeintel.lsiftyped.Descriptor
type Suffix = lsif.lib.codeintel.lsiftyped.Descriptor.Suffix
const Suffix = lsif.lib.codeintel.lsiftyped.Descriptor.Suffix

export function packageDescriptor(name: string): Descriptor {
  return new Descriptor({ name, suffix: Suffix.Package })
}

export function typeDescriptor(name: string): Descriptor {
  return new Descriptor({ name, suffix: Suffix.Type })
}

export function termDescriptor(name: string): Descriptor {
  return new Descriptor({ name, suffix: Suffix.Term })
}

export function metaDescriptor(name: string): Descriptor {
  return new Descriptor({ name, suffix: Suffix.Meta })
}

export function methodDescriptor(name: string): Descriptor {
  return new Descriptor({ name, suffix: Suffix.Method })
}

export function parameterDescriptor(name: string): Descriptor {
  return new Descriptor({ name, suffix: Suffix.Parameter })
}

export function typeParameterDescriptor(name: string): Descriptor {
  return new Descriptor({ name, suffix: Suffix.TypeParameter })
}

export function descriptorString(desc: Descriptor): string {
  switch (desc.suffix) {
    case Suffix.Package:
      return escapedName(desc) + '/'
    case Suffix.Type:
      return escapedName(desc) + '#'
    case Suffix.Term:
      return escapedName(desc) + '.'
    case Suffix.Meta:
      return escapedName(desc) + ':'
    case Suffix.Method:
      return escapedName(desc) + '(' + (desc.disambiguator || '') + ').'
    case Suffix.Parameter:
      return '(' + escapedName(desc) + ')'
    case Suffix.TypeParameter:
      return '[' + escapedName(desc) + ']'
    default:
      throw new Error(`unknown descriptor suffix: ${desc.suffix}`)
  }
}

function escapedName(desc: Descriptor): string {
  if (!desc.name) {
    return ''
  }
  if (isSimpleIdentifier(desc.name)) {
    return desc.name
  }
  return '`' + desc.name.replace(/`/g, '``') + '`'
}

// Returns true if this name does not need to be backtick escaped
function isSimpleIdentifier(name: string): boolean {
  return /^[\w$+-]+$/i.test(name)
}

