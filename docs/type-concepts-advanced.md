## Static Typing: Advanced Topics

### Type Narrowing

Pyright uses a technique called “type narrowing” to track the type of an expression based on code flow. Consider the following code:

```python
val_str: str = "hi"
val_int: int = 3

def func(val: float | str | complex, test: bool):
    reveal_type(val) # int | str | complex

    val = val_int # Type is narrowed to int
    reveal_type(val) # int

    if test:
        val = val_str # Type is narrowed to str
        reveal_type(val) # str
    
    reveal_type(val) # int | str

    if isinstance(val, int):
        reveal_type(val) # int
        print(val)
    else:
        reveal_type(val) # str
        print(val)
```

At the start of this function, the type checker knows nothing about `val` other than that its declared type is `float | str | complex`. Then it is assigned a value that has a known type of `int`. This is a legal assignment because `int` is considered a subclass of `float`. At the point in the code immediately after the assignment, the type checker knows that the type of `val` is an `int`. This is a “narrower” (more specific) type than `float | str | complex`. Type narrowing is applied whenever a symbol is assigned a new value.

Another assignment occurs several lines further down, this time within a conditional block. The symbol `val` is assigned a value known to be of type `str`, so the narrowed type of `val` is now `str`. Once the code flow of the conditional block merges with the main body of the function, the narrowed type of `val` becomes `int | str` because the type checker cannot statically predict whether the conditional block will be executed at runtime.

Another way that types can be narrowed is through the use of conditional code flow statements like `if`, `while`, and `assert`. Type narrowing applies to the block of code that is “guarded” by that condition, so type narrowing in this context is sometimes referred to as a “type guard”. For example, if you see the conditional statement `if x is None:`, the code within that `if` statement can assume that `x` contains `None`. Within the code sample above, we see an example of a type guard involving a call to `isinstance`. The type checker knows that `isinstance(val, int)` will return True only in the case where `val` contains a value of type `int`, not type `str`. So the code within the `if` block can assume that `val` contains a value of type `int`, and the code within the `else` block can assume that `val` contains a value of type `str`. This demonstrates how a type (in this case `int | str`) can be narrowed in both a positive (`if`) and negative (`else`) test.

The following expression forms support type narrowing:

* `<ident>` (where `<ident>` is an identifier)
* `<expr>.<member>` (member access expression where `<expr>` is a supported expression form)
* `<expr>[<int>]` (subscript expression where `<int>` is a non-negative integer)
* `<expr>[<str>]` (subscript expression where `<str>` is a string literal)

Examples of expressions that support type narrowing:

* `my_var`
* `employee.name`
* `a.foo.next`
* `args[3]`
* `kwargs["bar"]`
* `a.b.c[3]["x"].d`


### Type Guards

In addition to assignment-based type narrowing, Pyright supports the following type guards.

* `x is None` and `x is not None`
* `x == None` and `x != None`
* `x is ...` and `x is not ...` (where `...` is an ellipsis token)
* `x == ...` and `x != ...` (where `...` is an ellipsis token)
* `type(x) is T` and `type(x) is not T`
* `type(x) == T` and `type(x) != T`
* `x is E` and `x is not E` (where E is a literal enum or bool)
* `x is C` and `x is not C` (where C is a class)
* `x == L` and `x != L` (where L is an expression that evaluates to a literal type)
* `x.y is None` and `x.y is not None` (where x is a type that is distinguished by a field with a None)
* `x.y is E` and `x.y is not E` (where E is a literal enum or bool and x is a type that is distinguished by a field with a literal type)
* `x.y == LN` and `x.y != LN` (where LN is a literal expression or `None` and x is a type that is distinguished by a field or property with a literal type)
* `x[K] == V`, `x[K] != V`, `x[K] is V`, and `x[K] is not V` (where K and V are literal expressions and x is a type that is distinguished by a TypedDict field with a literal type)
* `x[I] == V` and `x[I] != V` (where I and V are literal expressions and x is a known-length tuple that is distinguished by the index indicated by I)
* `x[I] is B` and `x[I] is not B` (where I is a literal expression, B is a `bool` or enum literal, and x is a known-length tuple that is distinguished by the index indicated by I)
* `x[I] is None` and `x[I] is not None` (where I is a literal expression and x is a known-length tuple that is distinguished by the index indicated by I)
* `len(x) == L`, `len(x) != L`, `len(x) < L`, etc. (where x is tuple and L is an expression that evaluates to an int literal type)
* `x in y` or `x not in y` (where y is instance of list, set, frozenset, deque, tuple, dict, defaultdict, or OrderedDict)
* `S in D` and `S not in D` (where S is a string literal and D is a TypedDict)
* `isinstance(x, T)` (where T is a type or a tuple of types)
* `issubclass(x, T)` (where T is a type or a tuple of types)
* `callable(x)`
* `f(x)` (where f is a user-defined type guard as defined in [PEP 647](https://www.python.org/dev/peps/pep-0647/) or [PEP 742](https://www.python.org/dev/peps/pep-0742))
* `bool(x)` (where x is any expression that is statically verifiable to be truthy or falsey in all cases)
* `x` (where x is any expression that is statically verifiable to be truthy or falsey in all cases)

Expressions supported for type guards include simple names, member access chains (e.g. `a.b.c.d`), the unary `not` operator, the binary `and` and `or` operators, subscripts that are integer literals (e.g. `a[2]` or `a[-1]`), and call expressions. Other operators (such as arithmetic operators or other subscripts) are not supported.

Some type guards are able to narrow in both the positive and negative cases. Positive cases are used in `if` statements, and negative cases are used in `else` statements. (Positive and negative cases are flipped if the type guard expression is preceded by a `not` operator.) In some cases, the type can be narrowed only in the positive or negative case but not both. Consider the following examples:

```python
class Foo: pass
class Bar: pass

def func1(val: Foo | Bar):
    if isinstance(val, Bar):
        reveal_type(val) # Bar
    else:
        reveal_type(val) # Foo

def func2(val: float | None):
    if val:
        reveal_type(val) # float
    else:
        reveal_type(val) # float | None
```

In the example of `func1`, the type was narrowed in both the positive and negative cases. In the example of `func2`, the type was narrowed only the positive case because the type of `val` might be either `float` (specifically, a value of 0.0) or `None` in the negative case.

### Aliased Conditional Expression

Pyright also supports a type guard expression `c`, where `c` is an identifier that refers to a local variable that is assigned one of the above supported type guard expression forms. These are called “aliased conditional expressions”. Examples include `c = a is not None` and `c = isinstance(a, str)`. When “c” is used within a conditional check, it can be used to narrow the type of expression `a`.

This pattern is supported only in cases where `c` is a local variable within a module or function scope and is assigned a value only once. It is also limited to cases where expression `a` is a simple identifier (as opposed to a member access expression or subscript expression), is local to the function or module scope, and is assigned only once within the scope. Unary `not` operators are allowed for expression `a`, but binary `and` and `or` are not.

```python
def func1(x: str | None):
    is_str = x is not None

    if is_str:
        reveal_type(x) # str
    else:
        reveal_type(x) # None
```

```python
def func2(val: str | bytes):
    is_str = not isinstance(val, bytes)

    if not is_str:
        reveal_type(val) # bytes
    else:
        reveal_type(val) # str
```

```python
def func3(x: list[str | None]) -> str:
    is_str = x[0] is not None

    if is_str:
        # This technique doesn't work for subscript expressions,
        # so x[0] is not narrowed in this case.
        reveal_type(x[0]) # str | None
```

```python
def func4(x: str | None):
    is_str = x is not None

    if is_str:
        # This technique doesn't work in cases where the target
        # expression is assigned elsewhere. Here `x` is assigned
        # elsewhere in the function, so its type is not narrowed
        # in this case.
        reveal_type(x) # str | None
    
    x = ""
```

### Narrowing for Implied Else

When an “if” or “elif” clause is used without a corresponding “else”, Pyright will generally assume that the code can “fall through” without executing the “if” or “elif” block. However, there are cases where the analyzer can determine that a fall-through is not possible because the “if” or “elif” is guaranteed to be executed based on type analysis.

```python
def func1(x: int):
    if x == 1 or x == 2:
        y = True
    
    print(y) # Error: "y" is possibly unbound

def func2(x: Literal[1, 2]):
    if x == 1 or x == 2:
        y = True
    
    print(y) # No error
```

This can be especially useful when exhausting all members in an enum or types in a union.

```python
from enum import Enum

class Color(Enum):
    RED = 1
    BLUE = 2
    GREEN = 3

def func3(color: Color) -> str:
    if color == Color.RED or color == Color.BLUE:
        return "yes"
    elif color == Color.GREEN:
        return "no"

def func4(value: str | int) -> str:
    if isinstance(value, str):
        return "received a str"
    elif isinstance(value, int):
        return "received an int"
```

If you later added another color to the `Color` enumeration above (e.g. `YELLOW = 4`), Pyright would detect that `func3` no longer exhausts all members of the enumeration and possibly returns `None`, which violates the declared return type. Likewise, if you modify the type of the `value` parameter in `func4` to expand the union, a similar error will be produced.

This “narrowing for implied else” technique works for all narrowing expressions listed above with the exception of simple falsey/truthy statements and type guards. It is also limited to simple names and doesn’t work with member access or index expressions, and it requires that the name has a declared type (an explicit type annotation). These limitations are imposed because this functionality would otherwise have significant impact on analysis performance.


### Narrowing Any

In general, the type `Any` is not narrowed. The only exceptions to this rule are the built-in `isinstance` and `issubclass` type guards, class pattern matching in “match” statements, and user-defined type guards. In all other cases, `Any` is left as is, even for assignments.

```python
a: Any = 3
reveal_type(a) # Any

a = "hi"
reveal_type(a) # Any
```

The same applies to `Any` when it is used as a type argument.

```python
b: Iterable[Any] = [1, 2, 3]
reveal_type(b) # list[Any]

c: Iterable[str] = [""]
b = c
reveal_type(b) # list[Any]
```

### Narrowing for Captured Variables

If a variable’s type is narrowed in an outer scope and the variable is subsequently captured by an inner-scoped function or lambda, Pyright retains the narrowed type if it can determine that the value of the captured variable is not modified on any code path after the inner-scope function or lambda is defined and is not modified in another scope via a `nonlocal` or `global` binding.

```python
def func(val: int | None):
    if val is not None:

        def inner_1() -> None:
            reveal_type(val)  # int
            print(val + 1)

        inner_2 = lambda: reveal_type(val) + 1  # int

        inner_1()
        inner_2()
```

### Value-Constrained Type Variables

When a TypeVar is defined, it can be constrained to two or more types (values).

```python
# Example of unconstrained type variable
_T = TypeVar("_T")

# Example of value-constrained type variables
_StrOrFloat = TypeVar("_StrOrFloat", str, float)
```

When a value-constrained TypeVar appears more than once within a function signature, the type provided for all instances of the TypeVar must be consistent.

```python
def add(a: _StrOrFloat, b: _StrOrFloat) -> _StrOrFloat:
    return a + b

# The arguments for `a` and `b` are both `str`
v1 = add("hi", "there")
reveal_type(v1) # str

# The arguments for `a` and `b` are both `float`
v2 = add(1.3, 2.4)
reveal_type(v2) # float

# The arguments for `a` and `b` are inconsistent types
v3 = add(1.3, "hi") # Error
```

### Conditional Types and Type Variables

When checking the implementation of a function that uses type variables in its signature, the type checker must verify that type consistency is guaranteed. Consider the following example, where the input parameter and return type are both annotated with a type variable. The type checker must verify that if a caller passes an argument of type `str`, then all code paths must return a `str`. Likewise, if a caller passes an argument of type `float`, all code paths must return a `float`.

```python
def add_one(value: _StrOrFloat) -> _StrOrFloat:
    if isinstance(value, str):
        sum = value + "1"
    else:
        sum = value + 1

    reveal_type(sum)  # str* | float*
    return sum
```

The type of variable `sum` is reported with a star (`*`). This indicates that internally the type checker is tracking the type as a “conditional” type. In this particular example, it indicates that `sum` is a `str` type if the parameter `value` is a `str` but is a `float` if `value` is a `float`. By tracking these conditional types, the type checker can verify that the return type is consistent with the return type `_StrOrFloat`. Conditional types are a form of _intersection_ type, and they are considered subtypes of both the concrete type and the type variable.


### Inferred Type of “self” and “cls” Parameters

When a type annotation for a method’s `self` or `cls` parameter is omitted, pyright will infer its type based on the class that contains the method. The inferred type is internally represented as a type variable that is bound to the class.

The type of `self` is represented as `Self@ClassName` where `ClassName` is the class that contains the method. Likewise, the `cls` parameter in a class method will have the type `Type[Self@ClassName]`.

```python
class Parent:
    def method1(self):
        reveal_type(self)  # Self@Parent
        return self
    
    @classmethod
    def method2(cls):
        reveal_type(cls)  # Type[Self@Parent]
        return cls

class Child(Parent):
     ...
    
reveal_type(Child().method1())  # Child
reveal_type(Child.method2())  # Type[Child]
```

### Overloads

Some functions or methods can return one of several different types. In cases where the return type depends on the types of the input arguments, it is useful to specify this using a series of `@overload` signatures. When Pyright evaluates a call expression, it determines which overload signature best matches the supplied arguments.

[PEP 484](https://www.python.org/dev/peps/pep-0484/#function-method-overloading) introduced the `@overload` decorator and described how it can be used, but the PEP did not specify precisely how a type checker should choose the “best” overload. Pyright uses the following rules.

1. Pyright first filters the list of overloads based on simple “arity” (number of arguments) and keyword argument matching. For example, if one overload requires two positional arguments but only one positional argument is supplied by the caller, that overload is eliminated from consideration. Likewise, if the call includes a keyword argument but no corresponding parameter is included in the overload, it is eliminated from consideration.

2. Pyright next considers the types of the arguments and compares them to the declared types of the corresponding parameters. If the types do not match for a given overload, that overload is eliminated from consideration. Bidirectional type inference is used to determine the types of the argument expressions.

3. If only one overload remains, it is the “winner”.

4. If more than one overload remains, the “winner” is chosen based on the order in which the overloads are declared. In general, the first remaining overload is the “winner”. There are two exceptions to this rule.
    Exception 1: When an `*args` (unpacked) argument matches a `*args` parameter in one of the overload signatures, this overrides the normal order-based rule.
    Exception 2: When two or more overloads match because an argument evaluates to `Any` or `Unknown`, the matching overload is ambiguous. In this case, pyright examines the return types of the remaining overloads and eliminates types that are duplicates or are subsumed by (i.e. proper subtypes of) other types in the list. If only one type remains after this coalescing step, that type is used. If more than one type remains after this coalescing step, the type of the call expression evaluates to `Unknown`. For example, if two overloads are matched due to an argument that evaluates to `Any`, and those two overloads have return types of `str` and `LiteralString`, pyright will coalesce this to just `str` because `LiteralString` is a proper subtype of `str`. If the two overloads have return types of `str` and `bytes`, the call expression will evaluate to `Unknown` because `str` and `bytes` have no overlap.

5. If no overloads remain, Pyright considers whether any of the arguments are union types. If so, these union types are expanded into their constituent subtypes, and the entire process of overload matching is repeated with the expanded argument types. If two or more overloads match, the union of their respective return types form the final return type for the call expression. This "union expansion" can result in a combinatoric explosion if many arguments evaluate to union types. For example, if four arguments are present, and they all evaluate to unions that expand to ten subtypes, this could result in 10^4 combinations. Pyright expands unions for arguments left to right and halts expansion when the number of signatures exceeds 64.

6. If no overloads remain and all unions have been expanded, a diagnostic is generated indicating that the supplied arguments are incompatible with all overload signatures.


### Class and Instance Variables

Most object-oriented languages clearly differentiate between class variables and instance variables. Python is a bit looser in that it allows an object to overwrite a class variable with an instance variable of the same name.

```python
class A:
    my_var = 0

    def my_method(self):
        self.my_var = "hi!"

a = A()
print(A.my_var) # Class variable value of 0
print(a.my_var) # Class variable value of 0

A.my_var = 1
print(A.my_var) # Updated class variable value of 1
print(a.my_var) # Updated class variable value of 1

a.my_method() # Writes to the instance variable my_var
print(A.my_var) # Class variable value of 1
print(a.my_var) # Instance variable value of "hi!"

A.my_var = 2
print(A.my_var) # Updated class variable value of 2
print(a.my_var) # Instance variable value of "hi!"
```

Pyright differentiates between three types of variables: pure class variables, regular class variables, and pure instance variables.

#### Pure Class Variables
If a class variable is declared with a `ClassVar` annotation as described in [PEP 526](https://peps.python.org/pep-0526/#class-and-instance-variable-annotations), it is considered a “pure class variable” and cannot be overwritten by an instance variable of the same name.

```python
from typing import ClassVar

class A:
    x: ClassVar[int] = 0

    def instance_method(self):
        self.x = 1  # Type error: Cannot overwrite class variable
    
    @classmethod
    def class_method(cls):
        cls.x = 1

a = A()
print(A.x)
print(a.x)

A.x = 1
a.x = 2  # Type error: Cannot overwrite class variable
```

#### Regular Class Variables
If a class variable is declared without a `ClassVar` annotation, it can be overwritten by an instance variable of the same name. The declared type of the instance variable is assumed to be the same as the declared type of the class variable.

Regular class variables can also be declared within a class method using a `cls` member access expression, but declaring regular class variables within the class body is more common and generally preferred for readability.

```python
class A:
    x: int = 0
    y: int

    def instance_method(self):
        self.x = 1
        self.y = 2
    
    @classmethod
    def class_method(cls):
        cls.z: int = 3

A.y = 0
A.z = 0
print(f"{A.x}, {A.y}, {A.z}")  # 0, 0, 0

A.class_method()
print(f"{A.x}, {A.y}, {A.z}")  # 0, 0, 3

a = A()
print(f"{a.x}, {a.y}, {a.z}")  # 0, 0, 3
a.instance_method()
print(f"{a.x}, {a.y}, {a.z}")  # 1, 2, 3

a.x = "hi!"  # Error: Incompatible type
```

#### Pure Instance Variables
If a variable is not declared within the class body but is instead declared within a class method using a `self` member access expression, it is considered a “pure instance variable”. Such variables cannot be accessed through a class reference.

```python
class A:
    def __init__(self):
        self.x: int = 0
        self.y: int

print(A.x)  # Error: 'x' is not a class variable

a = A()
print(a.x)

a.x = 1
a.y = 2
print(f"{a.x}, {a.y}")  # 1, 2

print(a.z)  # Error: 'z' is not an known member
```

#### Inheritance of Class and Instance Variables
Class and instance variables are inherited from parent classes. If a parent class declares the type of a class or instance variable, a derived class must honor that type when assigning to it.

```python
class Parent:
    x: int | str | None
    y: int

class Child(Parent):
    x = "hi!"
    y = None  # Error: Incompatible type
```

The derived class can redeclare the type of a class or instance variable. If `reportIncompatibleVariableOverride` is enabled, the redeclared type must be the same as the type declared by the parent class. If the variable is immutable (as in a frozen `dataclass`), it is considered covariant, and it can be redeclared as a subtype of the type declared by the parent class.

```python
class Parent:
    x: int | str | None
    y: int

class Child(Parent):
    x: int  # Type error: 'x' cannot be redeclared with subtype because variable is mutable and therefore invariant
    y: str  # Type error: 'y' cannot be redeclared with an incompatible type
```

If a parent class declares the type of a class or instance variable and a derived class does not redeclare it but does assign a value to it, the declared type is retained from the parent class. It is not overridden by the inferred type of the assignment in the derived class.

```python
class Parent:
    x: object

class Child(Parent):
    x = 3

reveal_type(Parent.x)  # object
reveal_type(Child.x)  # object
```

If neither the parent nor the derived class declare the type of a class or instance variable, the type is inferred within each class.

```python
class Parent:
    x = object()

class Child(Parent):
    x = 3

reveal_type(Parent.x)  # object
reveal_type(Child.x)  # int
```

#### Type Variable Scoping

A type variable must be bound to a valid scope (a class, function, or type alias) before it can be used within that scope.

Pyright displays the bound scope for a type variable using an `@` symbol. For example, `T@func` means that type variable `T` is bound to function `func`.

```python
S = TypeVar("S")
T = TypeVar("T")

def func(a: T) -> T:
    b: T = a # T refers to T@func
    reveal_type(b) # T@func

    c: S # Error: S has no bound scope in this context
    return b
```

When a TypeVar or ParamSpec appears within parameter or return type annotations for a function and it is not already bound to an outer scope, it is normally bound to the function. As an exception to this rule, if the TypeVar or ParamSpec appears only within the return type annotation of the function and only within a single Callable in the return type, it is bound to that Callable rather than the function. This allows a function to return a generic Callable.

```python
# T is bound to func1 because it appears in a parameter type annotation.
def func1(a: T) -> Callable[[T], T]:
    a: T # OK because T is bound to func1

# T is bound to the return callable rather than func2 because it appears
# only within a return Callable.
def func2() -> Callable[[T], T]:
    a: T # Error because T has no bound scope in this context

# T is bound to func3 because it appears outside of a Callable.
def func3() -> Callable[[T], T] | T:
    ...

# This scoping logic applies also to type aliases used within a return
# type annotation. T is bound to the return Callable rather than func4.
Transform = Callable[[S], S]
def func4() -> Transform[T]:
    ...
```

### Type Annotation Comments
Versions of Python prior to 3.6 did not support type annotations for variables. Pyright honors type annotations found within a comment at the end of the same line where a variable is assigned.

```python
offsets = [] # type: list[int]

self._target = 3 # type: int | str
```

Future versions of Python will likely deprecate support for type annotation comments. The “reportTypeCommentUsage” diagnostic will report usage of such comments so they can be replaced with inline type annotations.

