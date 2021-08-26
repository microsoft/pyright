## Understanding Typing

Getting started with typing in Python is easy, but it’s important to understand a few simple concepts.

### Type Declarations
When you add a type annotation to a variable or a parameter in Python, you are _declaring_ that the symbol will be assigned values that are compatible with that type. You can think of type annotations as a powerful way to comment your code. Unlike text-based comments, these comments are readable by both humans and enforceable by type checkers.

If a variable or parameter has no type annotation, the type checker must assume that any value can be assigned to it. This eliminates the ability for a type checker to identify type incompatibilities.


### Type Assignability
When your code assigns a value to a symbol (in an assignment expression) or a parameter (in a call expression), the type checker first determines the type of the value being assigned. It then determines whether the target has a declared type. If so, it verifies that the type of the value is _assignable_ to the declared type.

Let’s look at a few simple examples. In this first example, the declared type of `a` is `float`, and it is assigned a value that is an `int`. This is permitted because `int` is assignable to `float`.

```
a: float = 3
```

In this example, the declared type of `b` is `int`, and it is assigned a value that is a `float`. This is flagged as an error because `float` is not assignable to `int`.

```
b: int = 3.4  # Error
```

This example introduces the notion of a _Union type_, which specifies that a value can be one of several distinct types.

```
c: Union[int, float] = 3.4
c = 5
c = a
c = b
c = None  # Error
c = ""  # Error
```

This example introduces the _Optional_ type, which is the same as a union with `None`.

```
d: Optional[int] = 4
d = b
d = None
d = ""  # Error
```

Those examples are straightforward. Let’s look at one that is less intuitive. In this example, the declared type of `f` is `List[Optional[int]]`. A value of type `List[int]` is being assigned to `f`. As we saw above, `int` is assignable to `Optional[int]`. You might therefore assume that `List[int]` is assignable to `List[Optional[int]]`, but this is an incorrect assumption. To understand why, we need to understand generic types and type arguments.

```
e: List[int] = [3, 4]
f: List[Optional[int]] = e  # Error
```

### Generic Types

A _generic type_ is a class that is able to handle different types of inputs. For example, the `List` class is generic because it is able to operate on different types of elements. The type `List` by itself does not specify what is contained within the list. Its element type must be specified as a _type argument_ using the indexing (square bracket) syntax in Python. For example, `List[int]` denotes a list that contains only `int` elements whereas `List[Union[int, float]]` denotes a list that contains a mixture of int and float elements.

We noted above that `List[int]` is not assignable to `List[Optional[int]]`. Why is this the case? Consider the following example.

```
my_list_1: List[int] = [1, 2, 3]
my_list_2: List[Optional[int]] = my_list_1  # Error
my_list_2.append(None)

for elem in my_list_1:
    print(elem + 1)  # Runtime exception
```

The code is appending the value `None` to the list `my_list_2`, but `my_list_2` refers to the same object as `my_list_1`, which has a declared type of `List[int]`. The code has violated the type of `my_list_1` because it no longer contains only `int` elements. This broken assumption results in a runtime exception. The type checker detects this broken assumption when the code attempts to assign `my_list_1` to `my_list_2`.

`List` is an example of a _mutable container type_. It is mutable in that code is allowed to modify its contents — for example, add or remove items. The type parameters for mutable container types are typically marked as _invariant_, which means that an exact type match is enforced. This is why the type checker reports an error when attempting to assign a `List[int]` to a variable of type `List[Optional[int]]`.

Most mutable container types also have immutable counterparts.

| Mutable Type      | Immutable Type |
| ----------------- | -------------- |
| List              | Sequence       |
| Dict              | Mapping        |
| Set               | AbstractSet    |
| n/a               | Tuple          |


Switching from a mutable container type to a corresponding immutable container type is often an effective way to resolve type errors relating to assignability. Let’s modify the example above by changing the type annotation for `my_list_2`.

```
my_list_1: List[int] = [1, 2, 3]
my_list_2: Sequence[Optional[int]] = my_list_1  # No longer an error
my_list_2.append(None)  # Error
```

The type error on the second line has now gone away, but a new error is reported on the third line because the `append` operation is not allowed on an immutable Sequence.

For more details about generic types, type parameters, and invariance, refer to [PEP 483 — The Theory of Type Hints](https://www.python.org/dev/peps/pep-0483/).


### Type Narrowing

Pyright uses a technique called “type narrowing” to track the type of an expression based on code flow. Consider the following code:

```python
val_str: str = "hi"
val_int: int = 3

def func(val: Union[float, str, complex], test: bool):
    reveal_type(val) # Union[int, str, complex]

    val = val_int # Type is narrowed to int
    reveal_type(val) # int

    if test:
        val = val_str # Type is narrowed to str
        reveal_type(val) # str
    
    reveal_type(val) # Union[int, str]

    if isinstance(val, int):
        reveal_type(val) # int
        print(val)
    else:
        reveal_type(val) # str
        print(val)
```

At the start of this function, the type checker knows nothing about `val` other than that its declared type is `Union[float, str, complex]`. Then it is assigned a value that has a known type of `int`. This is a legal assignment because `int` is considered a subclass of `float`. At the point in the code immediately after the assignment, the type checker knows that the type of `val` is an `int`. This is a “narrower” (more specific) type than `Union[float, str, complex]`. Type narrowing is applied when ever a symbol is assigned a new value.

Another assignment occurs several lines further down, this time within a conditional block. The symbol `val` is assigned a value known to be of type `str`, so the narrowed type of `val` is now `str`. Once the code flow of the conditional block merges with the main body of the function, the narrowed type of `val` becomes `Union[int, str]` because the type checker cannot statically predict whether the conditional block will be executed at runtime.

Another way that types can be narrowed is through the use of conditional code flow statements like `if`, `while`, and `assert`. Type narrowing applies to the block of code that is “guarded” by that condition, so type narrowing in this context is sometimes referred to as a “type guard”. For example, if you see the conditional statement `if x is None:`, the code within that `if` statement can assume that `x` contains `None`. Within the code sample above, we see an example of a type guard involving a call to `isinstance`. The type checker knows that `isinstance(val, int)` will return True only in the case where `val` contains a value of type `int`, not type `str`. So the code within the `if` block can assume that `val` contains a value of type `int`, and the code within the `else` block can assume that `val` contains a value of type `str`. This demonstrates how a type (in this case `Union[int, str]`) can be narrowed in both a positive (`if`) and negative (`else`) test.

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
* `type(x) is T` and `type(x) is not T`
* `x is E` and `x is not E` (where E is an enum value or True or False)
* `x == L` and `x != L` (where L is a literal expression)
* `x.y == L` and `x.y != L` (where L is a literal expression and x is a type that is distinguished by a field with a literal type)
* `x[K] == V` and `x[K] != V` (where K and V are literal expressions and x is a type that is distinguished by a TypedDict field with a literal type)
* `x[I] == V` and `x[I] != V` (where I and V are literal expressions and x is a known-length tuple that is distinguished by the index indicated by I)
* `x in y` (where y is instance of list, set, frozenset, or deque)
* `S in D` and `S not in D` (where S is a string literal and D is a TypedDict)
* `isinstance(x, T)` (where T is a type or a tuple of types)
* `issubclass(x, T)` (where T is a type or a tuple of types)
* `callable(x)`
* `f(x)` (where f is a user-defined type guard as defined in [PEP 647](https://www.python.org/dev/peps/pep-0647/))
* `x` (where x is any expression that is statically verifiable to be truthy or falsy in all cases)

Expressions supported for type guards include simple names, member access chains (e.g. `a.b.c.d`), the unary `not` operator, the binary `and` and `or` operators, subscripts that are constant numbers (e.g. `a[2]`), and call expressions. Other operators (such as arithmetic operators or other subscripts) are not supported.

Some type guards are able to narrow in both the positive and negative cases. Positive cases are used in `if` statements, and negative cases are used in `else` statements. (Positive and negative cases are flipped if the type guard expression is preceded by a `not` operator.) In some cases, the type can be narrowed only in the positive or negative case but not both. Consider the following examples:

```python
class Foo: pass
class Bar: pass

def func1(val: Union[Foo, Bar]):
    if isinstance(Bar):
        reveal_type(val) # Bar
    else:
        reveal_type(val) # Foo

def func2(val: Optional[int]):
    if val:
        reveal_type(val) # int
    else:
        reveal_type(val) # Optional[int]
```

In the example of `func1`, the type was narrowed in both the positive and negative cases. In the example of `func2`, the type was narrowed only the positive case because the type of `val` might be either `int` (specifically, a value of 0) or `None` in the negative case.

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

This “narrowing for implied else” technique works for all narrowing expressions listed above with the exception of simple falsy/truthy statements and type guards. These are excluded because they are not generally used for exhaustive checks, and their inclusion would have a significant impact on analysis performance.

### Narrowing Any

In general, the type `Any` is not narrowed. The only exceptions to this rule are the built-in `isinstance` and `issubclass` type guards plus user-defined type guards. In all other cases, `Any` is left as is, even for assignments.

```python
a: Any = 3
reveal_type(a) # Any

a = "hi"
reveal_type(a) # Any
```

The same applies to `Any` when it is used as a type argument.

```python
b: Iterable[Any] = [1, 2, 3]
reveal_type(b) # List[Any]

c: Iterable[str] = [""]
b = c
reveal_type(b) # List[Any]
```

### Constrained Type Variables and Conditional Types

When a TypeVar is defined, it can be constrained to two or more types.

```python
# Example of unconstrained type variable
_T = TypeVar("_T")

# Example of constrained type variables
_StrOrFloat = TypeVar("_StrOrFloat", str, float)
```

When a constrained TypeVar appears more than once within a function signature, the type provided for all instances of the TypeVar must be consistent.

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

When checking the implementation of a function that uses constrained type variables in its signature, the type checker must verify that type consistency is guaranteed. Consider the following example, where the input parameter and return type are both annotated with a constrained type variable. The type checker must verify that if a caller passes an argument of type `str`, then all code paths must return a `str`. Likewise, if a caller passes an argument of type `float`, all code paths must return a `float`.

```python
def add_one(value: _StrOrFloat) -> _StrOrFloat:
    if isinstance(value, str):
        sum = value + "1"
    else:
        sum = value + 1

    reveal_type(sum)  # str* | float*
    return sum
```

Notice that the type of variable `sum` is reported with asterisks (`*`). This indicates that internally the type checker is tracking the type as conditional. In this particular example, it indicates that `sum` is a `str` type if the parameter `value` is a `str` but is a `float` if `value` is a `float`. By tracking these conditional types, the type checker can verify that the return type is consistent with the return type `_StrOrFloat`.
