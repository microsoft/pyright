## Pyright Features

### Speed
Pyright is a fast type checker meant for large Python source bases. It can run in a “watch” mode and performs fast incremental updates when files are modified.

### Configurability
Pyright supports [configuration files](configuration.md) that provide granular control over settings. Different “execution environments” can be associated with subdirectories within a source base. Each environment can specify different module search paths, python language versions, and platform targets.

### Type Checking Features
* [PEP 484](https://www.python.org/dev/peps/pep-0484/) type hints including generics
* [PEP 487](https://www.python.org/dev/peps/pep-0487/) simpler customization of class creation
* [PEP 526](https://www.python.org/dev/peps/pep-0526/) syntax for variable annotations
* [PEP 544](https://www.python.org/dev/peps/pep-0544/) structural subtyping
* [PEP 561](https://www.python.org/dev/peps/pep-0561/) distributing and packaging type information
* [PEP 563](https://www.python.org/dev/peps/pep-0563/) postponed evaluation of annotations
* [PEP 570](https://www.python.org/dev/peps/pep-0570/) position-only parameters
* [PEP 585](https://www.python.org/dev/peps/pep-0585/) type hinting generics in standard collections
* [PEP 586](https://www.python.org/dev/peps/pep-0586/) literal types
* [PEP 589](https://www.python.org/dev/peps/pep-0589/) typed dictionaries
* [PEP 591](https://www.python.org/dev/peps/pep-0591/) final qualifier
* [PEP 593](https://www.python.org/dev/peps/pep-0593/) flexible variable annotations
* [PEP 604](https://www.python.org/dev/peps/pep-0604/) complementary syntax for unions
* [PEP 612](https://www.python.org/dev/peps/pep-0612/) parameter specification variables
* [PEP 613](https://www.python.org/dev/peps/pep-0613/) explicit type aliases
* [PEP 635](https://www.python.org/dev/peps/pep-0635/) structural pattern matching
* [PEP 646](https://www.python.org/dev/peps/pep-0646/) variadic generics
* [PEP 647](https://www.python.org/dev/peps/pep-0647/) user-defined type guards
* [PEP 655](https://www.python.org/dev/peps/pep-0655/) required typed dictionary items
* [PEP 673](https://www.python.org/dev/peps/pep-0673/) Self type
* [PEP 675](https://www.python.org/dev/peps/pep-0675/) arbitrary literal strings
* [PEP 681](https://www.python.org/dev/peps/pep-0681/) dataclass transform
* [PEP 692](https://www.python.org/dev/peps/pep-0692/) TypedDict for kwargs typing
* [PEP 695](https://www.python.org/dev/peps/pep-0695/) type parameter syntax
* [PEP 696](https://www.python.org/dev/peps/pep-0696/) (draft) type defaults for TypeVarLikes
* [PEP 698](https://www.python.org/dev/peps/pep-0698/) override decorator for static typing
* [PEP 702](https://www.python.org/dev/peps/pep-0702/) (draft) marking deprecations
* [PEP 705](https://www.python.org/dev/peps/pep-0705/) (draft) TypedDict: read-only items
* [PEP 712](https://www.python.org/dev/peps/pep-0712/) (draft) converter parameter on dataclasses.field
* [PEP 724](https://www.python.org/dev/peps/pep-0724/) (draft) stricter type guards
* Type inference for function return values, instance variables, class variables, and globals
* Type guards that understand conditional code flow constructs like if/else statements

### Language Server Support
Pyright ships as both a command-line tool and a language server that provides many powerful features that help improve programming efficiency.

* Intelligent type completion of keywords, symbols, and import names appears when editing
* Import statements are automatically inserted when necessary for type completions
* Signature completion tips help when filling in arguments for a call
* Hover over symbols to provide type information and doc strings
* Find Definitions to quickly go to the location of a symbol’s definition
* Find References to find all references to a symbol within a code base
* Rename Symbol to rename all references to a symbol within a code base
* Find Symbols within the current document or within the entire workspace
* View call hierarchy information — calls made within a function and places where a function is called
* Organize Imports command for automatically ordering imports according to PEP8 rules
* Type stub generation for third-party libraries

### Built-in Type Stubs
Pyright includes a recent copy of the stdlib type stubs from [Typeshed](https://github.com/python/typeshed). It can be configured to use another (perhaps more recent or modified) copy of the Typeshed type stubs. Of course, it also works with custom type stub files that are part of your project.

## Limitations
Pyright provides support for Python 3.0 and newer. There are no plans to support older versions.


