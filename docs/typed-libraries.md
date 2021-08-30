# Typing Guidance for Python Libraries

Much of Python’s popularity can be attributed to the rich collection of Python libraries available to developers. Authors of these libraries play an important role in improving the experience for Python developers. This document provides some recommendations and guidance for Python library authors.

These recommendations are intended to provide the following benefits:

1. Consumers of libraries should have a great coding experience with fast and accurate completion suggestions, class and function documentation, signature help (including parameter default values), hover text, and auto-imports. This should happen by default without needing to download extra packages and without any special configuration. These features should be consistent across the Python ecosystem regardless of a developer’s choice of editor, IDE, notebook environment, etc.
2. Consumers of libraries should be able to rely on complete and accurate type information so static type checkers can detect and report type inconsistencies and other violations of the interface contract.
3. Library authors should be able to specify a well-defined interface contract that is enforced by tools. This allows a library implementation to evolve and improve without breaking consumers of the library.
4. Library authors should have the benefits of static type checking to produce high-quality, bug-free implementations.


## Inlined Type Annotations and Type Stubs
[PEP 561](https://www.python.org/dev/peps/pep-0561/) documents several ways type information can be delivered for a library: inlined type annotations, type stub files included in the package, a separate companion type stub package, and type stubs in the typeshed repository. Some of these options fall short on delivering the benefits above. We therefore provide the following more specific guidance to library authors.

*All libraries should include inlined type annotations for the functions, classes, methods, and constants that comprise the public interface for the library.*

Inlined type annotations should be included directly within the source code that ships with the package. Of the options listed in PEP 561, inlined type annotations offer the most benefits. They typically require the least effort to add and maintain, they are always consistent with the implementation, and docstrings and default parameter values are readily available, allowing language servers to enhance the development experience.

There are cases where inlined type annotations are not possible — most notably when a library’s exposed functionality is implemented in a language other than Python.

*Libraries that expose symbols implemented in languages other than Python should include stub (“.pyi”) files that describe the types for those symbols. These stubs should also contain docstrings and default parameter values.*

In many existing type stubs (such as those found in typeshed), default parameter values are replaced with with “...” and all docstrings are removed. We recommend that default values and docstrings remain within the type stub file so language servers can display this information to developers.


## Library Interface
[PEP 561](https://www.python.org/dev/peps/pep-0561/) indicates that a “py.typed” marker file must be included in the package if the author wishes to support type checking of their code.

If a “py.typed” module is present, a type checker will treat all modules within that package (i.e. all files that end in “.py” or “.pyi”) as importable unless the file name begins with an underscore. These modules comprise the supported interface for the library.

Each module exposes a set of symbols. Some of these symbols are considered “private” — implementation details that are not part of the library’s interface. Type checkers like pyright use the following rules to determine which symbols are visible outside of the package.

* Symbols whose names begin with an underscore (but are not dunder names) are considered private.
* Imported symbols are considered private by default. If they use the “import A as A” (a redundant module alias), “from X import A as A” (a redundant symbol alias), or “from . import A” forms, symbol “A” is not private unless the name begins with an underscore. If a file `__init__.py` uses form “from .A import X”, symbol “A” is treated likewise. If a wildcard import (of the form “from X import *”) is used, all symbols referenced by the wildcard are not private.
* A module can expose an `__all__` symbol at the module level that provides a list of names that are considered part of the interface. This overrides all other rules above, allowing imported symbols or symbols whose names begin with an underscore to be included in the interface.
* Local variables within a function (including nested functions) are always considered private.

The following idioms are supported for defining the values contained within `__all__`. These restrictions allow type checkers to statically determine the value of `__all__`.

* `__all__ = ('a', b')`
* `__all__ = ['a', b']`
* `__all__ += ['a', b']`
* `__all__ += submodule.__all__`
* `__all__.extend(['a', b'])`
* `__all__.extend(submodule.__all__)`
* `__all__.append('a')`
* `__all__.remove('a')`


## Type Completeness
A “py.typed” library is said to be “type complete” if all of the symbols that comprise its interface have type annotations that refer to types that are fully known. Private symbols are exempt.

A “known type” is defined as follows:

Classes:

* All class variables, instance variables, and methods that are “visible” (not overridden) are annotated and refer to known types
* If a class is a subclass of a generic class, type arguments are provided for each generic type parameter, and these type arguments are known types

Functions and Methods:

* All input parameters have type annotations that refer to known types
* The return parameter is annotated and refers to a known type
* The result of applying one or more decorators results in a known type

Type Aliases:

* All of the types referenced by the type alias are known

Variables:

* All variables have type annotations that refer to known types

Type annotations can be omitted in a few specific cases where the type is obvious from the context:

* Constants that are assigned simple literal values (e.g. `RED = '#F00'` or `MAX_TIMEOUT = 50` or `room_temperature: Final = 20`). A constant is a symbol that is assigned only once and is either annotated with `Final` or is named in all-caps. A constant that is not assigned a simple literal value requires explicit annotations, preferably with a `Final` annotation (e.g. `WOODWINDS: Final[List[str]] = ['Oboe', 'Bassoon']`).
* Enum values within an Enum class do not require annotations because they take on the type of the Enum class.
* Type aliases do not require annotations. A type alias is a symbol that is defined at a module level with a single assignment where the assigned value is an instantiable type, as opposed to a class instance (e.g. `Foo = Callable[[Literal["a", "b"]], Union[int, str]]` or `Bar = Optional[MyGenericClass[int]]`).
* The “self” parameter in an instance method and the “cls” parameter in a class method do not require an explicit annotation.
* The return type for an `__init__` method does not need to be specified, since it is always `None`.
* The following module-level symbols do not require type annotations: `__all__`,`__author__`, `__copyright__`, `__email__`, `__license__`, `__title__`, `__uri__`, `__version__`.
* The following class-level symbols do not require type annotations: `__class__`, `__dict__`, `__doc__`, `__module__`, `__slots__`.

### Examples of known and unknown types
```python

# Variable with unknown type
a = [3, 4, 5]

# Variable with known type
a: List[int] = [3, 4, 5]

# Type alias with partially unknown type (because type
# arguments are missing for list and dict)
DictOrList = Union[list, dict]

# Type alias with known type
DictOrList = Union[List[Any], Dict[str, Any]]

# Generic type alias with known type
_T = TypeVar("_T")
DictOrList = Union[List[_T], Dict[str, _T]]

# Function with known type
def func(a: Optional[int], b: Dict[str, float] = {}) -> None:
    pass

# Function with partially unknown type (because type annotations
# are missing for input parameters and return type)
def func(a, b):
    pass

# Function with partially unknown type (because of missing
# type args on Dict)
def func(a: int, b: Dict) -> None:
    pass

# Function with partially unknown type (because return type
# annotation is missing)
def func(a: int, b: Dict[str, float]):
    pass

# Decorator with partially unknown type (because type annotations
# are missing for input parameters and return type)
def my_decorator(func):
    return func

# Function with partially unknown type (because type is obscured
# by untyped decorator)
@my_decorator
def func(a: int) -> str:
    pass


# Class with known type
class MyClass:
    height: float = 2.0

    def __init__(self, name: str, age: int):
        self.age: int = age

    @property
    def name(self) -> str:
        ...

# Class with partially unknown type
class MyClass:
    # Missing type annotation for class variable
    height = 2.0

    # Missing input parameter annotations
    def __init__(self, name, age):
        # Missing type annotation for instance variable
        self.age = age

    # Missing return type annotation
    @property
    def name(self):
        ...

# Class with partially unknown type
class BaseClass:
    # Missing type annotation
    height = 2.0

    # Missing type annotation
    def get_stuff(self):
        ...

# Class with known type (because it overrides all symbols
# exposed by BaseClass that have incomplete types)
class DerivedClass(BaseClass):
    height: float

    def get_stuff(self) -> str:
        ...

# Class with partially unknown type because base class
# (dict) is generic, and type arguments are not specified.
class DictSubclass(dict):
    pass

```

## Verifying Type Completeness
Pyright provides a feature that allows library authors to verify type completeness for a “py.typed” package. To use this feature, create a clean Python environment and install your package along with all of the other dependent packages. Run the CLI version of pyright with the `--verifytypes` option.

`pyright --verifytypes <lib>`

Pyright will analyze the library, identify all symbols that comprise the interface to the library and emit errors for any symbols whose types are unknown. It also produces a “type completeness score” which is the percentage of symbols with known types.

To see additional details (including a full list of symbols in the library), append the `--verbose` option.

The `--verifytypes` option can be combined with `--outputjson` to emit the results in a form that can be consumed by other tools.

The `--verifytypes` feature can be integrated into a continuous integration (CI) system to verify that a library remains “type complete”.

If the `--verifytypes` option is combined with `--ignoreexternal`, any incomplete types that are imported from other external packages are ignored. This allows library authors to focus on adding type annotations for the code that is directly under their control.


### Improving Type Completeness

Here are some tips for increasing the type completeness score for your library:

* If your package includes tests or sample code, consider removing them from the distribution. If there is good reason to include them, consider placing them in a directory that begins with an underscore so they are not considered part of your library’s interface.
* If your package includes submodules that are meant to be implementation details, rename those files to begin with an underscore.
* If a symbol is not intended to be part of the library’s interface and is considered an implementation detail, rename it such that it begins with an underscore. It will then be considered private and excluded from the type completeness check.
* If your package exposes types from other libraries, work with the maintainers of these other libraries to achieve type completeness.


## Best Practices for Inlined Types

### Wide vs. Narrow Types
In type theory, when comparing two types that are related to each other, the “wider” type is the one that is more general, and the “narrower” type is more specific. For example, `Sequence[str]` is a wider type than `List[str]` because all `List` objects are also `Sequence` objects, but the converse is not true. A subclass is narrower than a class it derives from. A union of types is wider than the individual types that comprise the union.

In general, a function input parameter should be annotated with the widest possible type supported by the implementation. For example, if the implementation requires the caller to provide an iterable collection of strings, the parameter should be annotated as `Iterable[str]`, not as `List[str]`. The latter type is narrower than necessary, so if a user attempts to pass a tuple of strings (which is supported by the implementation), a type checker will complain about a type incompatibility.

As a specific application of the “use the widest type possible” rule, libraries should generally use immutable forms of container types instead of mutable forms (unless the function needs to modify the container). Use `Sequence` rather than `List`, `Mapping` rather than `Dict`, etc. Immutable containers allow for more flexibility because their type parameters are covariant rather than invariant. A parameter that is typed as `Sequence[Union[str, int]]` can accept a `List[int]`, `Sequence[str]`, and a `Sequence[int]`. But a parameter typed as `List[Union[str, int]]` is much more restrictive and accepts only a `List[Union[str, int]]`.

### Overloads
If a function or method can return multiple different types and those types can be determined based on the presence or types of certain parameters, use the `@overload` mechanism defined in [PEP 484](https://www.python.org/dev/peps/pep-0484/#id45). When overloads are used within a “.py” file, they must appear prior to the function implementation, which should not have an `@overload` decorator. 

### Keyword-only Parameters
If a function or method is intended to take parameters that are specified only by name, use the keyword-only separator ("*").

```python
def create_user(age: int, *, dob: Optional[date] = None):
    ...
```

### Annotating Decorators
Decorators modify the behavior of a class or a function. Providing annotations for decorators is straightforward if the decorator retains the original signature of the decorated function.

```python
_F = TypeVar("_F", bound=Callable[..., Any])

def simple_decorator(_func: _F) -> _F:
	"""
     Simple decorators are invoked without parentheses like this:
       @simple_decorator
       def my_function(): ...
     """
   ...

def complex_decorator(*, mode: str) -> Callable[[_F], _F]:
	"""
     Complex decorators are invoked with arguments like this:
       @complex_decorator(mode="easy")
       def my_function(): ...
     """
   ...
```

Decorators that mutate the signature of the decorated function present challenges for type annotations. The `ParamSpec` and `Concatenate` mechanisms described in [PEP 612](https://www.python.org/dev/peps/pep-0612/) provide some help here, but these are available only in Python 3.10 and newer. More complex signature mutations may require type annotations that erase the original signature, thus blinding type checkers and other tools that provide signature assistance. As such, library authors are discouraged from creating decorators that mutate function signatures in this manner.

### Generic Classes and Functions
Classes and functions that can operate in a generic manner on various types should declare themselves as generic using the mechanisms described in [PEP 484](https://www.python.org/dev/peps/pep-0484/). This includes the use of `TypeVar` symbols. Typically, a `TypeVar` should be private to the file that declares it, and should therefore begin with an underscore.

### Type Aliases
Type aliases are symbols that refer to other types. Generic type aliases (those that refer to unspecialized generic classes) are supported by most type checkers. Pyright also provides support for recursive type aliases.

[PEP 613](https://www.python.org/dev/peps/pep-0613/) provides a way to explicitly designate a symbol as a type alias using the new TypeAlias annotation.

```python
# Simple type alias
FamilyPet = Union[Cat, Dog, GoldFish]

# Generic type alias
ListOrTuple = Union[List[_T], Tuple[_T, ...]]

# Recursive type alias
TreeNode = Union[LeafNode, List["TreeNode"]]

# Explicit type alias using PEP 613 syntax
StrOrInt: TypeAlias = Union[str, int]
```

### Abstract Classes and Methods
Classes that must be subclassed should derive from `ABC`, and methods or properties that must be overridden should be decorated with the `@abstractmethod` decorator. This allows type checkers to validate that the required methods have been overridden and provide developers with useful error messages when they are not. It is customary to implement an abstract method by raising a `NotImplementedError` exception.

```python
from abc import ABC, abstractmethod

class Hashable(ABC):
   @property
   @abstractmethod
   def hash_value(self) -> int:
      """Subclasses must override"""
      raise NotImplementedError()

   @abstractmethod
   def print(self) -> str:
      """Subclasses must override"""
      raise NotImplementedError()
```

### Final Classes and Methods
Classes that are not intended to be subclassed should be decorated as `@final` as described in [PEP 591](https://www.python.org/dev/peps/pep-0591/). The same decorator can also be used to specify methods that cannot be overridden by subclasses.

### Literals
Type annotations should make use of the Literal type where appropriate, as described in [PEP 586](https://www.python.org/dev/peps/pep-0586/). Literals allow for more type specificity than their non-literal counterparts.

### Constants
Constant values (those that are read-only) can be specified using the Final annotation as described in [PEP 591](https://www.python.org/dev/peps/pep-0591/).

Type checkers will also typically treat variables that are named using all upper-case characters as constants.

In both cases, it is OK to omit the declared type of a constant if it is assigned a literal str, int, float, bool or None value. In such cases, the type inference rules are clear and unambiguous, and adding a literal type annotation would be redundant.

```python
# All-caps constant with inferred type
COLOR_FORMAT_RGB = "rgb"

# All-caps constant with explicit type
COLOR_FORMAT_RGB: Literal["rgb"] = "rgb"
LATEST_VERSION: Tuple[int, int] = (4, 5)

# Final variable with inferred type
ColorFormatRgb: Final = "rgb"

# Final variable with explicit type
ColorFormatRgb: Final[Literal["rgb"]] = "rgb"
LATEST_VERSION: Final[Tuple[int, int]] = (4, 5)
```

### Typed Dictionaries, Data Classes, and Named Tuples
If your library runs only on newer versions of Python, you are encouraged to use some of the new type-friendly classes.

NamedTuple (described in [PEP 484](https://www.python.org/dev/peps/pep-0484/)) is preferred over namedtuple.

Data classes (described in [PEP 557](https://www.python.org/dev/peps/pep-0557/)) is preferred over untyped dictionaries.

TypedDict (described in [PEP 589](https://www.python.org/dev/peps/pep-0589/)) is preferred over untyped dictionaries.


## Compatibility with Older Python Versions
Each new version of Python from 3.5 onward has introduced new typing constructs. This presents a challenge for library authors who want to maintain runtime compatibility with older versions of Python. This section documents several techniques that can be used to add types while maintaining backward compatibility.

### Quoted Annotations
Type annotations for variables, parameters, and return types can be placed in quotes. The Python interpreter will then ignore them, whereas a type checker will interpret them as type annotations.

```python
# Older versions of Python do not support subscripting
# for the OrderedDict type, so the annotation must be
# enclosed in quotes.
def get_config(self) -> "OrderedDict[str, str]":
   return self._config
```

### Type Comment Annotations
Python 3.0 introduced syntax for parameter and return type annotations, as specified in [PEP 484](https://www.python.org/dev/peps/pep-0484/). Python 3.6 introduced support for variable type annotations, as specified in [PEP 526](https://www.python.org/dev/peps/pep-0526/).

If you need to support older versions of Python, type annotations can still be provided as “type comments”. These comments take the form # type: <annotation>.

```python
class Foo:
   # Variable type comments go at the end of the line
   # where the variable is assigned.
   timeout = None # type: Optional[int]
   
   # Function type comments can be specified on the
   # line after the function signature.
   def send_message(self, name, length):
      # type: (str, int) -> None
      ...

   # Function type comments can also specify the type
   # of each parameter on its own line.
   def receive_message(
      self,
      name, # type: str
      length # type: int
   ):
      # type: () -> Message
      ...
```

### typing_extensions
New type features that require runtime support are typically included in the stdlib `typing` module. Where possible, these new features are back-ported to a runtime library called `typing_extensions` that works with older Python runtimes.

### TYPE_CHECKING
The `typing` module exposes a variable called `TYPE_CHECKING` which has a value of False within the Python runtime but a value of True when the type checker is performing its analysis. This allows type checking statements to be conditionalized.

Care should be taken when using `TYPE_CHECKING` because behavioral changes between type checking and runtime could mask problems that the type checker would otherwise catch.


## Non-Standard Type Behaviors
Type annotations provide a way to annotate typical type behaviors, but some classes implement specialized, non-standard behaviors that cannot be described using standard type annotations. For now, such types need to be annotated as Any, which is unfortunate because the benefits of static typing are lost.


## Docstrings
Docstrings should be provided for all classes, functions, and methods in the interface. They should be formatted according to [PEP 257](https://www.python.org/dev/peps/pep-0257/).

There is currently no single agreed-upon standard for function and method docstrings, but several common variants have emerged. We recommend using one of these variants.

