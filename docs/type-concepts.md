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
