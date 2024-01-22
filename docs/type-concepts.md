## Static Typing: The Basics

Getting started with static type checking in Python is easy, but it’s important to understand a few simple concepts. In addition to the documentation below, you may also find the community-maintained [Static Typing Documentation](https://typing.readthedocs.io/en/latest/) to be of use. That site also includes the official [Specification for the Python Type System](https://typing.readthedocs.io/en/latest/spec/index.html).


### Type Declarations
When you add a type annotation to a variable or a parameter in Python, you are _declaring_ that the symbol will be assigned values that are compatible with that type. You can think of type annotations as a powerful way to comment your code. Unlike text-based comments, these comments are readable by both humans and enforceable by type checkers.

If a variable or parameter has no type annotation, Pyright will assume that any value can be assigned to it.


### Type Assignability
When your code assigns a value to a symbol (in an assignment expression) or a parameter (in a call expression), the type checker first determines the type of the value being assigned. It then determines whether the target has a declared type. If so, it verifies that the type of the value is _assignable_ to the declared type.

Let’s look at a few simple examples. In this first example, the declared type of `a` is `float`, and it is assigned a value that is an `int`. This is permitted because `int` is assignable to `float`.

```python
a: float = 3
```

In this example, the declared type of `b` is `int`, and it is assigned a value that is a `float`. This is flagged as an error because `float` is not assignable to `int`.

```python
b: int = 3.4  # Error
```

This example introduces the notion of a _Union type_, which specifies that a value can be one of several distinct types. A union type can be expressed using the `|` operator to combine individual types.

```python
c: int | float = 3.4
c = 5
c = a
c = b
c = None  # Error
c = ""  # Error
```

This example introduces the _Optional_ type, which is the same as a union with `None`.

```python
d: Optional[int] = 4
d = b
d = None
d = ""  # Error
```

Those examples are straightforward. Let’s look at one that is less intuitive. In this example, the declared type of `f` is `list[int | None]`. A value of type `list[int]` is being assigned to `f`. As we saw above, `int` is assignable to `int | None`. You might therefore assume that `list[int]` is assignable to `list[int | None]`, but this is an incorrect assumption. To understand why, we need to understand generic types and type arguments.

```python
e: list[int] = [3, 4]
f: list[int | None] = e  # Error
```

### Generic Types

A _generic type_ is a class that is able to handle different types of inputs. For example, the `list` class is generic because it is able to operate on different types of elements. The type `list` by itself does not specify what is contained within the list. Its element type must be specified as a _type argument_ using the indexing (square bracket) syntax in Python. For example, `list[int]` denotes a list that contains only `int` elements whereas `list[int | float]` denotes a list that contains a mixture of int and float elements.

We noted above that `list[int]` is not assignable to `list[int | None]`. Why is this the case? Consider the following example.

```python
my_list_1: list[int] = [1, 2, 3]
my_list_2: list[int | None] = my_list_1  # Error
my_list_2.append(None)

for elem in my_list_1:
    print(elem + 1)  # Runtime exception
```

The code is appending the value `None` to the list `my_list_2`, but `my_list_2` refers to the same object as `my_list_1`, which has a declared type of `list[int]`. The code has violated the type of `my_list_1` because it no longer contains only `int` elements. This broken assumption results in a runtime exception. The type checker detects this broken assumption when the code attempts to assign `my_list_1` to `my_list_2`.

`list` is an example of a _mutable container type_. It is mutable in that code is allowed to modify its contents — for example, add or remove items. The type parameters for mutable container types are typically marked as _invariant_, which means that an exact type match is enforced. This is why the type checker reports an error when attempting to assign a `list[int]` to a variable of type `list[int | None]`.

Most mutable container types also have immutable counterparts.

| Mutable Type      | Immutable Type |
| ----------------- | -------------- |
| list              | Sequence       |
| dict              | Mapping        |
| set               | Container      |
| n/a               | tuple          |


Switching from a mutable container type to a corresponding immutable container type is often an effective way to resolve type errors relating to assignability. Let’s modify the example above by changing the type annotation for `my_list_2`.

```python
my_list_1: list[int] = [1, 2, 3]
my_list_2: Sequence[int | None] = my_list_1  # No longer an error
```

The type error on the second line has now gone away.

For more details about generic types, type parameters, and invariance, refer to [PEP 483 — The Theory of Type Hints](https://www.python.org/dev/peps/pep-0483/).


### Debugging Types

When you want to know the type that the type checker has evaluated for an expression, you can use the special `reveal_type()` function:

```python
x = 1
reveal_type(x)  # Type of "x" is "Literal[1]"
```

This function is always available and does not need to be imported. When you use Pyright within an IDE, you can also simply hover over an identifier to see its evaluated type.
