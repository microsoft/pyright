## Differences Between Pyright and Mypy

### What is Mypy?

Mypy is the “OG” in the world of Python type checkers. It was started by Jukka Lehtosalo in 2012 with contributions from Guido van Rossum, Ivan Levkivskyi, and many others over the years. For a detailed history, refer to [this documentation](http://mypy-lang.org/about.html). The code for mypy can be found in [this github project](https://github.com/python/mypy).


### Why Does Pyright’s Behavior Differ from Mypy’s?

Mypy served as a reference implementation of [PEP 484](https://www.python.org/dev/peps/pep-0484/), which defines standard behaviors for Python static typing. Although PEP 484 spells out many type checking behaviors, it intentionally leaves many other behaviors undefined. This approach has allowed different type checkers to innovate and differentiate.

Pyright generally adheres to the official [Python typing specification](https://typing.readthedocs.io/en/latest/spec/index.html), which incorporates and builds upon PEP 484 and other typing-related PEPs. The typing spec is accompanied by an ever-expanding suite of conformance tests. For the latest conformance test results for pyright, mypy and other type checkers, refer to [this page](https://htmlpreview.github.io/?https://github.com/python/typing/blob/main/conformance/results/results.html).

For behaviors that are not explicitly spelled out in the typing spec, pyright generally tries to adhere to mypy’s behavior unless there is a compelling justification for deviating. This document discusses these differences and provides the reasoning behind each design choice.


### Design Goals

Pyright was designed with performance in mind. It is not unusual for pyright to be 3x to 5x faster than mypy when type checking large code bases. Some of its design decisions were motivated by this goal.

Pyright was also designed to be used as the foundation for a Python [language server](https://microsoft.github.io/language-server-protocol/). Language servers provide interactive programming features such as completion suggestions, function signature help, type information on hover, semantic-aware search, semantic-aware renaming, semantic token coloring, refactoring tools, etc. For a good user experience, these features require highly responsive type evaluation performance during interactive code modification. They also require type evaluation to work on code that is incomplete and contains syntax errors.

To achieve these design goals, pyright is implemented as a “lazy” or “just-in-time” type evaluator. Rather than analyzing all code in a module from top to bottom, it is able to evaluate the type of an arbitrary identifier anywhere within a module. If the type of that identifier depends on the types of other expressions or symbols, pyright recursively evaluates those in turn until it has enough information to determine the type of the target identifier. By comparison, mypy uses a more traditional multi-pass architecture where semantic analysis is performed multiple times on a module from the top to the bottom until all types converge.

Pyright implements its own parser, which recovers gracefully from syntax errors and continues parsing the remainder of the source file. By comparison, mypy uses the parser built in to the Python interpreter, and it does not support recovery after a syntax error. This also means that when you run mypy on an older version of Python, it cannot support newer language features that require grammar changes.


### Type Checking Unannotated Code

By default, pyright performs type checking for all code regardless of whether it contains type annotations. This is important for language server features. It is also important for catching bugs in code that is unannotated.

By default, mypy skips all functions or methods that do not have type annotations. This is a common source of confusion for mypy users who are surprised when type violations in unannotated functions go unreported. If the option `--check-untyped-defs` is enabled, mypy performs type checking for all functions and methods.


### Inferred Return Types

If a function or method lacks a return type annotation, pyright infers the return type from `return` and `yield` statements within the function’s body (including the implied `return None` at the end of the function body). This is important for supporting completion suggestions. It also improves type checking coverage and eliminates the need for developers to needlessly supply return type annotations for trivial return types.

By comparison, mypy never infers return types and assumes that functions without a return type annotation have a return type of `Any`. This was an intentional design decision by mypy developers and is explained in [this thread](https://github.com/python/mypy/issues/10149).


### Unions vs Joins

When merging two types during code flow analysis or widening types during constraint solving, pyright always uses a union operation. Mypy typically (but not always) uses a “join” operation, which merges types by finding a common supertype. The use of joins discards valuable type information and leads to many false positive errors that are [well documented within the mypy issue tracker](https://github.com/python/mypy/issues?q=is%3Aissue+is%3Aopen+label%3Atopic-join-v-union).

```python
def func1(val: object):
    if isinstance(val, str):
        pass
    elif isinstance(val, int):
        pass
    else:
        return
    reveal_type(val) # mypy: object, pyright: str | int
```


### Variable Type Declarations

Pyright treats variable type annotations as type declarations. If a variable is not annotated, pyright allows any value to be assigned to that variable, and its type is inferred to be the union of all assigned types.

Mypy’s behavior for variables depends on whether the [`--allow-redefinition`](https://mypy.readthedocs.io/en/stable/command_line.html#cmdoption-mypy-allow-redefinition) is specified. If redefinitions are not allowed, then mypy typically treats the first assignment (the one with the smallest line number) as though it is an implicit type declaration.

```python
def func1(condition: bool):
    if condition:
        x = 3 # Mypy treats this as an implicit type declaration
    else:
        x = "" # Mypy treats this as an error because `x` is implicitly declared as `int`

def func2(condition: bool):
    x = None # Mypy provides some exceptions; this is not considered an implicit type declaration

    if condition:
        x = "" # This is not considered an error

def func3(condition: bool):
    x = [] # Mypy doesn't treat this as a declaration

    if condition:
        x = [1, 2, 3] # The type of `x` is declared as `list[int]`
```

Pyright’s behavior is more consistent, is conceptually simpler and more natural for Python developers, leads to fewer false positives, and eliminates the need for many otherwise-necessary variable type annotations.


### Class and Instance Variable Inference

Pyright handles instance and class variables consistently with local variables. If a type annotation is provided for an instance or class variable (either within the class or one of its base classes), pyright treats this as a type declaration and enforces it accordingly. If a class implementation does not provide a type annotation for an instance or class variable and its base classes likewise do not provide a type annotation, the variable’s type is inferred from all assignments within the class implementation.

```python
class A:
    def method1(self) -> None:
        self.x = 1
    
    def method2(self) -> None:
        self.x = "" # Mypy treats this as an error because `x` is implicitly declared as `int`

a = A()
reveal_type(a.x) # pyright: int | str

a.x = "" # Pyright allows this because the type of `x` is `int | str`
a.x = 3.0 # Pyright treats this as an error because the type of `x` is `int | str`
```


### Class and Instance Variable Enforcement

Pyright distinguishes between “pure class variables”, “regular class variables”, and “pure instance variable”. For a detailed explanation, refer to [this documentation](type-concepts-advanced.md#class-and-instance-variables).

Mypy does not distinguish between class variables and instance variables in all cases. This is a [known issue](https://github.com/python/mypy/issues/240).

```python
class A:
    x: int = 0 # Regular class variable
    y: ClassVar[int] = 0 # Pure class variable

    def __init__(self):
        self.z = 0 # Pure instance variable

print(A.x)
print(A.y)
print(A.z) # pyright: error, mypy: no error
```


### Assignment-based Type Narrowing

Pyright applies type narrowing for variable assignments. This is done regardless of whether the assignment statement includes a variable type annotation. Mypy skips assignment-based type narrowing when the target variable includes a type annotation. The consensus of the typing community is that mypy’s behavior here is inconsistent, and there are [plans to eliminate this inconsistency](https://github.com/python/mypy/issues/2008).

```python
v1: Sequence[int]
v1 = [1, 2, 3]
reveal_type(v1) # mypy and pyright both reveal `list[int]`

v2: Sequence[int] = [1, 2, 3]
reveal_type(v2) # mypy reveals `Sequence[int]` rather than `list[int]`
```


### Type Guards

Pyright supports several built-in type guards that mypy does not currently support. For a full list of type guard expression forms supported by pyright, refer to [this documentation](type-concepts-advanced.md#type-guards).

The following expression forms are not currently supported by mypy as type guards:
* `x == L` and `x != L` (where L is an expression with a literal type)
* `x in y` or `x not in y` (where y is instance of list, set, frozenset, deque, tuple, dict, defaultdict, or OrderedDict)
* `bool(x)` (where x is any expression that is statically verifiable to be truthy or falsey in all cases)


### Aliased Conditional Expressions

Pyright supports the [aliasing of conditional expressions](type-concepts-advanced.md#aliased-conditional-expression) used for type guards. Mypy does not currently support this, but it is a frequently-requested feature.


### Narrowing Any

Pyright never narrows `Any` when performing type narrowing for assignments. Mypy is inconsistent about when it applies type narrowing to `Any` type arguments.

```python
b: list[Any]

b = [1, 2, 3]
reveal_type(b) # pyright: list[Any], mypy: list[Any]

c = [1, 2, 3]
b = c
reveal_type(b) # pyright: list[Any], mypy: list[int]
```


### Inference of List, Set, and Dict Expressions

Pyright’s inference rules for [list, set and dict expressions](type-inference.md#list-expressions) differ from mypy’s when values with heterogeneous types are used. Mypy uses a join operator to combine the types. Pyright uses either an `Unknown` or a union depending on configuration settings. A join operator often produces a type that is not what was intended, and this leads to false positive errors.

```python
x = [1, 3.4, ""]
reveal_type(x) # mypy: list[object], pyright: list[Unknown] or list[int | float | str]
```

For these mutable container types, pyright does not retain literal types when inferring the container type. Mypy is inconsistent, sometimes retaining literal types and sometimes not.

```python
def func(one: Literal[1]):
    reveal_type(one) # Literal[1]
    reveal_type([one]) # pyright: list[int], mypy: list[Literal[1]]

    reveal_type(1) # Literal[1]
    reveal_type([1]) # pyright: list[int], mypy: list[int]
```


### Inference of Tuple Expressions

Pyright’s inference rules for [tuple expressions](type-inference.md#tuple-expressions) differ from mypy’s when tuple entries contain literals. Pyright retains these literal types, but mypy widens the types to their non-literal type. Pyright retains the literal types in this case because tuples are immutable, and more precise (narrower) types are almost always beneficial in this situation.

```python
x = (1, "stop")
reveal_type(x[1]) # pyright: Literal["stop"], mypy: str

y: Literal["stop", "go"] = x[1] # mypy: type error
```


### Assignment-Based Narrowing for Literals

When assigning a literal value to a variable, pyright narrows the type to reflect the literal. Mypy does not. Pyright retains the literal types in this case because more precise (narrower) types are typically beneficial and have little or no downside.

```python
x: str | None
x = 'a'
reveal_type(x) # pyright: Literal['a'], mypy: str
```

Pyright also supports “literal math” for simple operations involving literals.

```python
def func1(a: Literal[1, 2], b: Literal[2, 3]):
    c = a + b
    reveal_type(c) # Literal[3, 4, 5]

def func2():
    c = "hi" + " there"
    reveal_type(c) # Literal['hi there']
```


### Type Narrowing for Asymmetric Descriptors

When pyright evaluates a write to a class variable that contains a descriptor object (including properties), it normally applies assignment-based type narrowing. However, when the descriptor is asymmetric — that is, its “getter” type is different from its “setter” type, pyright refrains from applying assignment-based type narrowing. For a full discussion of this, refer to [this issue](https://github.com/python/mypy/issues/3004). Mypy has not yet implemented the agreed-upon behavior, so its type narrowing behavior may differ from pyright’s in this case.


### Parameter Type Inference

Mypy infers the type of `self` and `cls` parameters in methods but otherwise does not infer any parameter types.

Pyright implements several parameter type inference techniques that improve type checking and language service features in the absence of explicit parameter type annotations. For details, refer to [this documentation](type-inference.md#parameter-type-inference).


### Constructor Calls

When pyright evaluates a call to a constructor, it attempts to follow the runtime behavior as closely as possible. At runtime, when a constructor is called, it invokes the `__call__` method of the metaclass. Most classes use `type` as their metaclass. (Even when a different metaclasses is used, it typically does not override `type.__call__`.) The `type.__call__` method calls the `__new__` method for the class and passes all of the arguments (both positional and keyword) that were passed to the constructor call. If the `__new__` method returns an instance of the class (or a child class), `type.__call__` then calls the `__init__` method on the class. Pyright follows this same flow for evaluating the type of a constructor call. If a custom metaclass is present, pyright evaluates its `__call__` method to determine whether it returns an instance of the class. If not, it assumes that the metaclass has custom behavior that overrides `type.__call__`. Likewise, if a class provides a `__new__` method that returns a type other than the class being constructed (or a child class thereof), it assumes that `__init__` will not be called.

By comparison, mypy first evaluates the `__init__` method if present, and it ignores the annotated return type of the `__new__` method.


### `None` Return Type

If the return type of a function is declared as `None`, an attempt to call that function and consume the returned value is flagged as an error by mypy. The justification is that this is a common source of bugs.

Pyright does not special-case `None` in this manner because there are legitimate use cases, and in our experience, this class of bug is rare.


### Constraint Solver Behaviors

When evaluating a call expression that invokes a generic class constructor or a generic function, a type checker performs a process called “constraint solving” to solve the type variables found within the target function signature. The solved type variables are then applied to the return type of that function to determine the final type of the call expression. This process is called “constraint solving” because it takes into account various constraints that are specified for each type variable. These constraints include variance rules and type variable bounds.

Many aspects of constraint solving are unspecified in PEP 484. This includes behaviors around literals, whether to use unions or joins to widen types, and how to handle cases where multiple types could satisfy all type constraints.

#### Constraint Solver: Literals

Pyright’s constraint solver retains literal types only when they are required to satisfy constraints. In other cases, it widens the type to a non-literal type. Mypy is inconsistent in its handling of literal types.

```python
T = TypeVar("T")
def identity(x: T) -> T:
    return x

def func(one: Literal[1]):
    reveal_type(one) # Literal[1]
    v1 = identity(one)
    reveal_type(v1) # pyright: int, mypy: Literal[1]

    reveal_type(1) # Literal[1]
    v2 = identity(1)
    reveal_type(v2) # pyright: int, mypy: int
```

#### Constraint Solver: Type Widening

As mentioned previously, pyright always uses unions rather than joins. Mypy typically uses joins. This applies to type widening during the constraint solving process.

```python
T = TypeVar("T")
def func(val1: T, val2: T) -> T:
    ...

reveal_type(func("", 1)) # mypy: object, pyright: str | int
```

#### Constraint Solver: Ambiguous Solution Scoring

In cases where more than one solution is possible for a type variable, both pyright and mypy employ various heuristics to pick the “best” solution. These heuristics are complex and difficult to document in their fullness. Pyright’s general strategy is to return the “simplest” type that meets the constraints.

Consider the expression `make_list(x)` in the example below. The type constraints for `T` could be satisfied with either `int` or `list[int]`, but it’s much more likely that the developer intended the former (simpler) solution. Pyright calculates all possible solutions and “scores” them according to complexity, then picks the type with the best score. In rare cases, there can be two results with the same score, in which chase pyright arbitrarily picks one as the winner.

Mypy produces errors with this sample.

```python
T = TypeVar("T")

def make_list(x: T | Iterable[T]) -> list[T]:
    return list(x) if isinstance(x, Iterable) else [x]

def func2(x: list[int], y: list[str] | int):
    v1 = make_list(x)
    reveal_type(v1) # pyright: "list[int]" ("list[list[T]]" is also a valid answer)

    v2 = make_list(y)
    reveal_type(v2) # pyright: "list[int | str]" ("list[list[str] | int]" is also a valid answer)
```

### Value-Constrained Type Variables

When mypy analyzes a class or function that has in-scope value-constrained TypeVars, it analyzes the class or function multiple times, once for each constraint. This can produce multiple errors.

```python
T = TypeVar("T", list[Any], set[Any])

def func(a: AnyStr, b: T):
    reveal_type(a) # Mypy reveals 2 different types ("str" and "bytes"), pyright reveals "AnyStr"
    return a + b # Mypy reports 4 errors
```

Pyright cannot use the same multi-pass technique as mypy in this case. It needs to produce a single type for any given identifier to support language server features. Pyright instead uses a mechanism called [conditional types](type-concepts-advanced.md#conditional-types-and-type-variables). This approach allows pyright to handle some value-constrained TypeVar use cases that mypy cannot, but there are conversely other use cases that mypy can handle and pyright cannot.


### “Unknown” Type and Strict Mode

Pyright differentiates between explicit and implicit forms of `Any`. The implicit form is referred to as [`Unknown`](type-inference.md#unknown-type). For example, if a parameter is annotated as `list[Any]`, that is a use of an explicit `Any`, but if a parameter is annotated as `list`, that is an implicit `Any`, so pyright refers to this type as `list[Unknown]`. Pyright implements several checks that are enabled in “strict” type-checking modes that report the use of an `Unknown` type. Such uses can mask type errors.

Mypy does not track the difference between explicit and implicit `Any` types, but it supports various checks that report the use of values whose type is `Any`: `--warn-return-any` and `--disallow-any-*`. For details, refer to [this documentation](https://mypy.readthedocs.io/en/stable/command_line.html#disallow-dynamic-typing).

Pyright’s approach gives developers more control. It provides a way to be explicit about `Any` where that is the intent. When an `Any` is implicitly produced due to an missing type argument or some other condition that produces an `Any` within the type checker logic, the developer is alerted to that condition.


### Overload Resolution

Overload resolution rules are under-specified in PEP 484. Pyright and mypy apply similar rules, but there are inevitably cases where different results will be produced. For full documentation of pyright’s overload behaviors, refer to [this documentation](type-concepts-advanced.md#overloads).

One known difference is in the handling of ambiguous overloads due to `Any` argument types where one return type is the supertype of all other return types. In this case, pyright evaluates the resulting return type as the supertype, but mypy evaluates the return type as `Any`. Pyright’s behavior here tries to preserve as much type information as possible, which is important for completion suggestions.

```python
@overload
def func1(x: int) -> int: ...

@overload
def func1(x: str) -> float: ...

def func2(val: Any):
    reveal_type(func1(val)) # mypy: Any, pyright: float
```


### Import Statements

Pyright intentionally does not model implicit side effects of the Python import loading mechanism. In general, such side effects cannot be modeled statically because they depend on execution order. Dependency on such side effects leads to fragile code, so pyright treats these as errors. For more details, refer to [this documentation](import-statements.md).

Mypy models side effects of the import loader that are potentially unsafe.

```python
import http

def func():
    import http.cookies

# The next line raises an exception at runtime
x = http.cookies  # mypy allows, pyright flags as error
```

### Ellipsis in Function Body

If Pyright encounters a function body whose implementation is `...`, it does not enforce the return type annotation. The `...` semantically means “this is a code placeholder” — a convention established in type stubs, protocol definitions, and elsewhere.

Mypy treats `...` function bodies as though they are executable and enforces the return type annotation. This was a recent change in mypy — made long after Pyright established a different behavior. Prior to mypy’s recent change, it did not enforce return types for function bodies consisting of either `...` or `pass`. Now it enforces both.


### Circular References

Because mypy is a multi-pass analyzer, it is able to deal with certain forms of circular references that pyright cannot handle. Here are several examples of circularities that mypy resolves without errors but pyright does not.

1. A class declaration that references a metaclass whose declaration depends on the class.

```python
T = TypeVar("T")
class MetaA(type, Generic[T]): ...
class A(metaclass=MetaA["A"]): ...
```

2. A class declaration that uses a TypeVar whose bound or constraint depends on the class.

```python
T = TypeVar("T", bound="A")
class A(Generic[T]): ...
```

3. A class that is decorated with a class decorator that uses the class in the decorator’s own signature.

```python
def my_decorator(x: Callable[..., "A"]) -> Callable[..., "A"]:
    return x

@my_decorator
class A: ...
```

### Class Decorator Evaluation

Pyright honors class decorators. Mypy largely ignores them. See [this issue](https://github.com/python/mypy/issues/3135) for details.


### Support for Type Comments

Versions of Python prior to 3.0 did not have a dedicated syntax for supplying type annotations. Annotations therefore needed to be supplied using “type comments” of the form `# type: <annotation>`. Python 3.6 added the ability to supply type annotations for variables. 

Mypy has full support for type comments. Pyright supports type comments only in locations where there is a way to provide an annotation using modern syntax. Pyright was written to assume Python 3.5 and newer, so support for older versions was not a priority.

```python
# The following type comment is supported by
# mypy but is rejected by pyright.
x, y = (3, 4) # type: (float, float)

# Using Python syntax from Python 3.6, this
# would be annotated as follows:
x: float
y: float
x, y = (3, 4)
```

### Plugins

Mypy supports a plug-in mechanism, whereas pyright does not. Mypy plugins allow developers to extend mypy’s capabilities to accommodate libraries that rely on behaviors that cannot be described using the standard type checking mechanisms.

Pyright maintainers have made the decision not to support plug-ins because of their many downsides: discoverability, maintainability, cost of development for the plug-in author, cost of maintenance for the plug-in object model and API, security, performance (especially latency — which is critical for language servers), and robustness. Instead, we have taken the approach of working with the typing community and library authors to extend the type system so it can accommodate more use cases. An example of this is [PEP 681](https://peps.python.org/pep-0681/), which introduced `dataclass_transform`.

