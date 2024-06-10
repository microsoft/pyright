## Understanding Type Inference

### Symbols and Scopes

In Python, a _symbol_ is any name that is not a keyword. Symbols can represent classes, functions, methods, variables, parameters, modules, type aliases, type variables, etc.

Symbols are defined within _scopes_. A scope is associated with a block of code and defines which symbols are visible to that code block. Scopes can be “nested” allowing code to see symbols within its immediate scope and all “outer” scopes.

The following constructs within Python define a scope:
1. The “builtins” scope is always present and is always the outermost scope. It is pre-populated by the Python interpreter with symbols like “int” and “list”.
2. The module scope (sometimes called the “global” scope) is defined by the current source code file.
3. Each class defines its own scope. Symbols that represent methods, class variables, or instance variables appear within a class scope.
4. Each function and lambda defines its own scope. The function’s parameters are symbols within its scope, as are any variables defined within the function.
5. List comprehensions define their own scope.

### Type Declarations

A symbol can be declared with an explicit type. The “def” and “class” keywords, for example, declare a symbol as a function or a class. Other symbols in Python can be introduced into a scope with no declared type. Newer versions of Python have introduced syntax for declaring the types of input parameters, return parameters, and variables.

When a parameter or variable is annotated with a type, the type checker verifies that all values assigned to that parameter or variable conform to that type.

Consider the following example:
```python
def func1(p1: float, p2: str, p3, **p4) -> None:
    var1: int = p1    # This is a type violation
    var2: str = p2    # This is allowed because the types match
    var2: int         # This is an error because it redeclares var2
    var3 = p1         # var3 does not have a declared type
    return var1       # This is a type violation
```

Symbol    | Symbol Category | Scope     | Declared Type
----------|-----------------|-----------|----------------------------------------------------
func1     | Function        | Module    | (float, str, Any, dict[str, Any]) -> None
p1        | Parameter       | func1     | float
p2        | Parameter       | func1     | str
p3        | Parameter       | func1     | <none>
p4        | Parameter       | func1     | <none>
var1      | Variable        | func1     | int
var2      | Variable        | func1     | str
var3      | Variable        | func1     | <none>


Note that once a symbol’s type is declared, it cannot be redeclared to a different type.

### Type Inference

Some languages require every symbol to be explicitly typed. Python allows a symbol to be bound to different values at runtime, so its type can change over time. A symbol’s type doesn’t need to be declared statically.

When Pyright encounters a symbol with no type declaration, it attempts to _infer_ the type based on the values assigned to it. As we will see below, type inference cannot always determine the correct (intended) type, so type annotations are still required in some cases. Furthermore, type inference can require significant computation, so it is much less efficient than when type annotations are provided.

### “Unknown” Type

If a symbol’s type cannot be inferred, Pyright sets its type to “Unknown”, which is a special form of “Any”. The “Unknown” type allows Pyright to optionally warn when types are not declared and cannot be inferred, thus leaving potential “blind spots” in type checking. 

#### Single-Assignment Type Inference

The simplest form of type inference is one that involves a single assignment to a symbol. The inferred type comes from the type of the source expression. Examples include:

```python
var1 = 3                        # Inferred type is int
var2 = "hi"                     # Inferred type is str
var3 = list()                   # Inferred type is list[Unknown]
var4 = [3, 4]                   # Inferred type is list[int]
for var5 in [3, 4]: ...         # Inferred type is int
var6 = [p for p in [1, 2, 3]]   # Inferred type is list[int]
```

#### Multi-Assignment Type Inference

When a symbol is assigned values in multiple places within the code, those values may have different types. The inferred type of the variable is the union of all such types.

```python
# In this example, symbol var1 has an inferred type of `str | int`]`.
class Foo:
    def __init__(self):
        self.var1 = ""
    
    def do_something(self, val: int):
        self.var1 = val

# In this example, symbol var2 has an inferred type of `Foo | None`.
if __debug__:
    var2 = None
else:
    var2 = Foo()
```

#### Ambiguous Type Inference

In some cases, an expression’s type is ambiguous. For example, what is the type of the expression `[]`? Is it `list[None]`, `list[int]`, `list[Any]`, `Sequence[Any]`, `Iterable[Any]`? These ambiguities can lead to unintended type violations. Pyright uses several techniques for reducing these ambiguities based on contextual information. In the absence of contextual information, heuristics are used.

#### Bidirectional Type Inference (Expected Types)

One powerful technique Pyright uses to eliminate type inference ambiguities is _bidirectional inference_. This technique makes use of an “expected type”.

As we saw above, the type of the expression `[]` is ambiguous, but if this expression is passed as an argument to a function, and the corresponding parameter is annotated with the type `list[int]`, Pyright can now assume that the type of `[]` in this context must be `list[int]`. Ambiguity eliminated!

This technique is called “bidirectional inference” because type inference for an assignment normally proceeds by first determining the type of the right-hand side (RHS) of the assignment, which then informs the type of the left-hand side (LHS) of the assignment. With bidirectional inference, if the LHS of an assignment has a declared type, it can influence the inferred type of the RHS.

Let’s look at a few examples:

```python
var1 = []                       # Type of RHS is ambiguous
var2: list[int] = []            # Type of LHS now makes type of RHS unambiguous
var3 = [4]                      # Type is assumed to be list[int] 
var4: list[float] = [4]         # Type of RHS is now list[float]
var5 = (3,)                     # Type is assumed to be tuple[Literal[3]]
var6: tuple[float, ...] = (3,)  # Type of RHS is now tuple[float, ...]
```

#### Empty List and Dictionary Type Inference

It is common to initialize a local variable or instance variable to an empty list (`[]`) or empty dictionary (`{}`) on one code path but initialize it to a non-empty list or dictionary on other code paths. In such cases, Pyright will infer the type based on the non-empty list or dictionary and suppress errors about a “partially unknown type”.

```python
if some_condition:
    my_list = []
else:
    my_list = ["a", "b"]

reveal_type(my_list) # list[str]
```


#### Return Type Inference

As with variable assignments, function return types can be inferred from the `return` statements found within that function. The returned type is assumed to be the union of all types returned from all `return` statements. If a `return` statement is not followed by an expression, it is assumed to return `None`. Likewise, if the function does not end in a `return` statement, and the end of the function is reachable, an implicit `return None` is assumed.

```python
# This function has two explicit return statements and one implicit
# return (at the end). It does not have a declared return type,
# so Pyright infers its return type based on the return expressions.
# In this case, the inferred return type is `str | bool | None`.

def func1(val: int):
    if val > 3:
        return ""
    elif val < 1:
        return True
```

#### NoReturn return type

If there is no code path that returns from a function (e.g. all code paths raise an exception), Pyright infers a return type of `NoReturn`. As an exception to this rule, if the function is decorated with `@abstractmethod`, the return type is not inferred as `NoReturn` even if there is no return. This accommodates a common practice where an abstract method is implemented with a `raise` statement that raises an exception of type `NotImplementedError`.

```python
class Foo:
    # The inferred return type is NoReturn.
    def method1(self):
        raise Exception()
    
    # The inferred return type is Unknown.
    @abstractmethod
    def method2(self):
        raise NotImplementedError()
```

#### Generator return types

Pyright can infer the return type for a generator function from the `yield` statements contained within that function.

#### Call-site Return Type Inference

It is common for input parameters to be unannotated. This can make it difficult for Pyright to infer the correct return type for a function. For example:

```python
# The return type of this function cannot be fully inferred based
# on the information provided because the types of parameters
# a and b are unknown. In this case, the inferred return
# type is `Unknown | None`.

def func1(a, b, c):
    if c:
        return a
    elif c > 3:
        return b
    else:
        return None
```

In cases where all parameters are unannotated, Pyright uses a technique called _call-site return type inference_. It performs type inference using the the types of arguments passed to the function in a call expression. If the unannotated function calls other functions, call-site return type inference can be used recursively. Pyright limits this recursion to a small number for practical performance reasons.

```python
def func2(p_int: int, p_str: str, p_flt: float):
    # The type of var1 is inferred to be `int | None` based
    # on call-site return type inference.
    var1 = func1(p_int, p_int, p_int)

    # The type of var2 is inferred to be `str | float | None`.
    var2 = func1(p_str, p_flt, p_int)
```

#### Parameter Type Inference

Input parameters for functions and methods typically require type annotations. There are several cases where Pyright may be able to infer a parameter’s type if it is unannotated.

For instance methods, the first parameter (named `self` by convention) is inferred to be type `Self`.

For class methods, the first parameter (named `cls` by convention) is inferred to be type `type[Self]`.

For other unannotated parameters within a method, Pyright looks for a method of the same name implemented in a base class. If the corresponding method in the base class has the same signature (the same number of parameters with the same names), no overloads, and annotated parameter types, the type annotation from this method is “inherited” for the corresponding parameter in the child class method.

```python
class Parent:
    def method1(self, a: int, b: str) -> float:
        ...


class Child(Parent):
    def method1(self, a, b):
        return a

reveal_type(Child.method1)  # (self: Child, a: int, b: str) -> int
```

When parameter types are inherited from a base class method, the return type is not inherited. Instead, normal return type inference techniques are used.

If the type of an unannotated parameter cannot be inferred using any of the above techniques and the parameter has a default argument expression associated with it, the parameter type is inferred from the default argument type. If the default argument is `None`, the inferred type is `Unknown | None`.

```python
def func(a, b=0, c=None):
    pass

reveal_type(func)  # (a: Unknown, b: int, c: Unknown | None) -> None
```

This inference technique also applies to lambdas whose input parameters include default arguments.

```python
cb = lambda x = "": x
reveal_type(cb)  # (x: str = "" -> str)
```

#### Literals

Python 3.8 introduced support for _literal types_. This allows a type checker like Pyright to track specific literal values of str, bytes, int, bool, and enum values. As with other types, literal types can be declared.

```python
# This function is allowed to return only values 1, 2 or 3.
def func1() -> Literal[1, 2, 3]:
    ...

# This function must be passed one of three specific string values.
def func2(mode: Literal["r", "w", "rw"]) -> None:
    ...
```

When Pyright is performing type inference, it generally does not infer literal types. Consider the following example:

```python
# If Pyright inferred the type of var1 to be list[Literal[4]],
# any attempt to append a value other than 4 to this list would
# generate an error. Pyright therefore infers the broader
# type list[int].
var1 = [4]
```

#### Tuple Expressions

When inferring the type of a tuple expression (in the absence of bidirectional inference hints), Pyright assumes that the tuple has a fixed length, and each tuple element is typed as specifically as possible.

```python
# The inferred type is tuple[Literal[1], Literal["a"], Literal[True]].
var1 = (1, "a", True)

def func1(a: int):
    # The inferred type is tuple[int, int].
    var2 = (a, a)

    # If you want the type to be tuple[int, ...]
    # (i.e. a homogeneous tuple of indeterminate length),
    # use a type annotation.
    var3: tuple[int, ...] = (a, a)
```

Because tuples are typed as specifically as possible, literal types are normally retained. However, as an exception to this inference rule, if the tuple expression is nested within another tuple, set, list or dictionary expression, literal types are not retained. This is done to avoid the inference of complex types (e.g. unions with many subtypes) when evaluating tuple statements with many entries.

```python
# The inferred type is list[tuple[int, str, bool]].
var4 = [(1, "a", True), (2, "b", False), (3, "c", False)]
```

#### List Expressions

When inferring the type of a list expression (in the absence of bidirectional inference hints), Pyright uses the following heuristics:

1. If the list is empty (`[]`), assume `list[Unknown]` (unless a known list type is assigned to the same variable along another code path).
2. If the list contains at least one element and all elements are the same type T, infer the type `list[T]`.
3. If the list contains multiple elements that are of different types, the behavior depends on the `strictListInference` configuration setting. By default this setting is off.

    * If `strictListInference` is off, infer `list[Unknown]`.
    * Otherwise use the union of all element types and infer `list[Union[(elements)]]`.

These heuristics can be overridden through the use of bidirectional inference hints (e.g. by providing a declared type for the target of the assignment expression).

```python
var1 = []                       # Infer list[Unknown]

var2 = [1, 2]                   # Infer list[int]

# Type depends on strictListInference config setting
var3 = [1, 3.4]                 # Infer list[Unknown] (off)
var3 = [1, 3.4]                 # Infer list[int | float] (on)

var4: list[float] = [1, 3.4]    # Infer list[float]
```


#### Set Expressions

When inferring the type of a set expression (in the absence of bidirectional inference hints), Pyright uses the following heuristics:

1. If the set contains at least one element and all elements are the same type T, infer the type `set[T]`.
2. If the set contains multiple elements that are of different types, the behavior depends on the `strictSetInference` configuration setting. By default this setting is off.

    * If `strictSetInference` is off, infer `set[Unknown]`.
    * Otherwise use the union of all element types and infer `set[Union[(elements)]]`.

These heuristics can be overridden through the use of bidirectional inference hints (e.g. by providing a declared type for the target of the assignment expression).

```python
var1 = {1, 2}                   # Infer set[int]

# Type depends on strictSetInference config setting
var2 = {1, 3.4}                 # Infer set[Unknown] (off)
var2 = {1, 3.4}                 # Infer set[int | float] (on)

var3: set[float] = {1, 3.4}    # Infer set[float]
```


#### Dictionary Expressions

When inferring the type of a dictionary expression (in the absence of bidirectional inference hints), Pyright uses the following heuristics:

1. If the dict is empty (`{}`), assume `dict[Unknown, Unknown]`.
2. If the dict contains at least one element and all keys are the same type K and all values are the same type V, infer the type `dict[K, V]`.
3. If the dict contains multiple elements where the keys or values differ in type, the behavior depends on the `strictDictionaryInference` configuration setting. By default this setting is off.

    * If `strictDictionaryInference` is off, infer `dict[Unknown, Unknown]`.
    * Otherwise use the union of all key and value types `dict[Union[(keys)], Union[(values)]]`.


```python
var1 = {}                       # Infer dict[Unknown, Unknown]

var2 = {1: ""}                  # Infer dict[int, str]

# Type depends on strictDictionaryInference config setting
var3 = {"a": 3, "b": 3.4}       # Infer dict[str, Unknown] (off)
var3 = {"a": 3, "b": 3.4}       # Infer dict[str, int | float] (on)

var4: dict[str, float] = {"a": 3, "b": 3.4}
```

#### Lambdas

Lambdas present a particular challenge for a Python type checker because there is no provision in the Python syntax for annotating the types of a lambda’s input parameters. The types of these parameters must therefore be inferred based on context using bidirectional type inference. Absent this context, a lambda’s input parameters (and often its return type) will be unknown.

```python
# The type of var1 is (a: Unknown, b: Unknown) -> Unknown.
var1 = lambda a, b: a + b

# This function takes a comparison function callback.
def float_sort(list: list[float], comp: Callable[[float, float], bool]): ...

# In this example, the types of the lambda’s input parameters
# a and b can be inferred to be float because the float_sort
# function expects a callback that accepts two floats as
# inputs.
float_sort([2, 1.3], lambda a, b: False if a < b else True)
```
