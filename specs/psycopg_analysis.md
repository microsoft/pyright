# Analysis of psycopg package

## Overview

The Python package `psycopg` is a "py.typed" package with inlined type annotations.

Users of Pylance reported that they were not receiving completion suggestions for certain symbols imported from psycopg. Running "pyright --verifytypes" on the library revealed that 349 of 1472 public symbols exported from the library were lacking type annotations and were therefore treated by Pyright’s logic as an `Unknown` type.

Daniele Varrazzo, the maintainer of `psycopg`, started a [discussion in the python/typing github project](https://github.com/python/typing/discussions/1058#discussioncomment-2153366) to discuss his concerns about the way Pyright was interpreting the unannotated variables in the package.

## Analysis

### Inheritance of Type Declarations

I analyzed the 349 symbols in `psycopg` that were flagged by Pyright as having "unknown or partially unknown types".

The vast majority of these cases were based on a common pattern where a base class provided a type annotation for a class or instance variable but a subclass simply assigned a value to that same class or instance variable without providing its own type declaration. Pyright's type evaluator already handles this case, using the declared type from the base class. The "--verifytypes" feature contained a bug where it incorrectly flagged these cases. I introduced a bug fix in Pyright 1.1.221 and updated the "Guidance for Library Authors" document to clarify the behavior. This eliminated 267 out of 349 symbols from the list.

It is worth noting that Python type checkers do not handle inherited type declarations in a consistent manner. Consider the following case:

```python
class Parent:
    foo: str | float

class Child(Parent):
    foo = 0

c = Child()
reveal_type(c.foo)
c.foo = "Hi"
```

Pyright always honors a type declaration if it is present. It falls back on type inference only when the developer has omitted a type annotation. This rule is applied consistently in all cases, including types of inherited class and instance variables. In the example above, Pyright evaluates the type of `c.foo` as `str | float`, and it allows a `str` value to be assigned to it.

By contrast, mypy treats some assignment statements as though they are implied type declarations. In the example above, mypy assumes that the value assignment `foo = 0` overrides the `foo: str | float` declaration. It therefore evaluates the type of `c.foo` as `int`, and it emits an error when attempting to assign a `str` value. I don't know if mypy authors intended this behavior, but it seems inconsistent and confusing. There is nothing in PEP 484 that specifies this behavior.

While this particular difference in behavior doesn't affect `psycopg`, it's a good example of inconsistent results between type checkers that can result when a type annotation is omitted. These are the types of inconsistencies that we want to avoid with "py.typed" libraries.

### Instance variable initialization from parameters

Another source of "symbols with unknown types" in `psycopg` are instance variables that have no type annotation but are assigned a value that comes from an annotated input parameter within the `__init__` method.

```python
class Foo:
    def __init__(self, name: str, age: int, weight: float) -> None:
        self.name = name
        self.age = age
        self.weight = weight
```

This pattern is common in Python code. It's probably safe to assume that all Python type checkers will infer the same types for these instance variables if the following conditions are met:

1. The value of the instance variable is assigned only once within the `__init__` method
2. The assignment is unconditional (e.g. not within an `if` statement)
3. There is no class variable declared with the same name within the class body
4. There is no instance or class variable of the same name declared within any of the classes that this class derives from (see comments above about inheritance)
5. The parameter is not reassigned a new value within the `__init__` method (since that could affect its type via narrowing)

If all of these conditions are met, it is likely safe to omit a type annotation and still expect to see the same behavior across all Python type checkers.

This case applies to 26 symbols in `psycopg`.

### Instance or class variable initialized from literal value

Another source of "symbols with unknown types" in `psycopg` are class or instance variables that are assigned a value specified as a literal int, float, str, bytes, or bool expression.

```python
class Foo:
    employed = False

    def __init__(self) -> None:
        self.name = "Bob"
        self.age = 21
        self.weight = 145.0
```

It is probably safe to assume that all Python type checkers will infer the same types for this pattern if the following conditions are met:

1. For instance variables, only one assignment is made to the instance variable within the class definition, this assignment is performed only within the `__init__` method, the assignment is not conditional (e.g. not within an `if` statement), and there is no class variable of the same name
2. For class variables, only one assignment is made to the variable within the class definition, this assignment is performed only within the class body, and the assignment is not conditional
3. The RHS of the assignment is one of the following expression forms:

- an integer literal token, optionally preceded by a `-` token (inferred to be `int`)
- a float literal token, optionally preceded by a `-` token (inferred to be `float`)
- a str literal token (inferred to be `str`)
- a bytes literal token (inferred to be `bytes`)
- False or True token (inferred to be `bool`)

4. There is no instance or class variable of the same name declared within any of the classes that this class derives from (see comments above about inheritance)

This case applies to 3 symbols in `psycopg`.

### Module (global) variables initialized from literal value

Another source of "symbols with unknown types" in `psycopg` are module-scoped (global) variables that are assigned a value specified as a literal int, float, str, bytes, or bool expression.

It is probably safe to assume that all Python type checkers will infer the same types for this pattern if the following conditions are met:

1. Only one assignment is made to the variable and the assignment is not conditional (e.g. not within an `if` or `try` statement).
2. The RHS of the assignment is one of the literal expression forms mentioned in the previous section.

This case applies to 4 symbols in `psycopg`.

### Other cases

The cases discussed above cover all but 49 of the "symbols with unknown types" in `psycopg`. The remainder can be categorized as follows.

Instance Variables

- (1) initialized with enum value
- (1) initialized with member access expression that accesses a property
- (3) initialized with call expression that invokes a constructor
- (2) initialized with more complex composite expression
- (3) initialized with more complex composite expression and named all-caps (probably intended to be Final)
- (1) assigned multiple values within class definition

Global Variables

- (1) initialized with member access expression that binds a class to a class method
- (1) initialized with member access expression that accesses a symbol imported from another module
- (2) initialized with call expression that invokes a constructor
- (8) conditional aliasing of a function (either local or imported)
- (4) symbols imported from another (untyped) library and used in the public interface

Likely Private Symbols

- (13) symbols that are almost certainly meant to be private but unintentionally "leaked" into the public namespace

Classes

- (9) Classes that include one or more instance or class variables whose types were deemed "partially unknown" (and are therefore already covered by above cases)

## Discussion

Explicit type declarations provide a clear and unambiguous way to describe the types of the symbols that comprise a library's public interface. When a type declaration is omitted, type checkers can fall back on a variety of type inference techniques to infer the intent of the library author, but these techniques are not standardized across type checkers. Depending on the circumstances, inferred type behaviors can vary greatly from one tool to the next. Even within a single type checker, type inference behaviors can change over time as improvements are made. This "type inference ambiguity" can lead to a bad experience for consumers of the library.

Currently, Pyright assumes that any package marked as "py.typed" will provide unambiguous type declarations for all of its public symbols. Any symbols that are left unannotated (with a few specific exceptions spelled out in the documentation) are interpreted by Pyright as `Unknown`. The intent behind this approach is to increase the visibility of the missing type annotations so library authors can take action and eliminate the holes.

While this approach has proven successful at raising the visibility with library authors, it has two significant downsides:

1. It effectively "punishes" users of Pyright and Pylance who consume "py.typed" libraries when type annotations are missing. When referencing these unannotated symbols, they receive no completion suggestions, and they receive difficult-to-correct errors when referencing these symbols in "strict" static type checking mode. Users have little or no recourse other than to report the problem to the library maintainer and hope that it is addressed in the next package update.
2. Some library maintainers are reluctant to add explicit type annotations in cases where they feel there is low risk of type inference ambiguity. This leaves them in an awkward situation when consumers of their library express dissatisfaction.

It is perhaps time to consider an alternative approach, one that better balances the interests of users and library authors.

## Recommendations

I'm recommending the following changes:

### Pyright's treatment of unannotated symbols in "py.typed" libraries

Today, Pyright treats unannotated symbols in a "py.typed" library as "Unknown" if type checking is enabled. When typeCheckingMode is "off", it falls back to its inference logic. This effectively "punishes" users who want to use Pyright and Pylance for static type checking. I recommend that we change this behavior and always fall back on type inference logic when annotations are not present. This change will unfortunately reduce the visibility of missing annotations, so I worry that it will slow efforts to improve type completeness and consistency across the Python ecosystem, but I think it represents a pragmatic tradeoff.

As a mitigation for this lack of visibility, we might want to modify Pyright and Pylance to display "ambiguous types" in a way that differentiates them from "unambiguous types". For example, we could prepend a `~` character to indicate that the type originated from a "py.typed" library and was inferred in a way that might be ambiguous.

### Modify "--verifytypes" to distinguish between "Unknown" and "Ambiguous"

The "--verifytypes" tool in Pyright currently draws a distinction between "known" and "unknown" types. I recommend that we add a third category of "ambiguous" types. These include symbols whose types Pyright can infer (without producing an `Unknown`) but may produce different inference results in other type checkers. Library authors who are interested in eliminating this ambiguity from their library can choose to add explicit type annotations. By distinguishing between "unknown" and "ambiguous" types, library authors can prioritize their efforts, focusing first on the symbols with "unknown" types.

If we implement this recommendation, the "--verifytypes" tool would emit the following output for the `psycopg` library.

```
Symbols exported by "psycopg": 1472
  With known type: 1390
  With partially unknown type: 4
  With inferred ambiguous type: 78

Other symbols referenced but not exported by "psycopg": 926
  With known type: 905
  With partially unknown type: 0
  With inferred ambiguous type: 21

Type completeness score: 94.4%
```

I recommend that we retain the "type completeness score" and that it reflect only "known" types when calculating the percentage. This will incentivize library authors to eliminate potentially ambiguous types by adding annotations.
