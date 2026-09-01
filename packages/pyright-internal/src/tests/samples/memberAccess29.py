# This sample tests assignments to an attribute when the base expression
# evaluates to a union whose subtypes declare the attribute with different
# (invariant) types. Assigning a value that is compatible with every subtype
# (such as an empty container that relies on bidirectional inference) should
# not produce a false positive.


class A:
    a: list[int]


class B:
    a: list[str]


class C:
    a: list[int]


class D:
    a: list[int]


def func1(x: A | B):
    # An empty list is compatible with both list[int] and list[str], so this
    # should not generate an error.
    x.a = []

    # This should generate an error because list[int] is not assignable to B.a.
    x.a = [1]

    # This should generate an error because list[str] is not assignable to A.a.
    x.a = ["hi"]


def func2(x: C | D):
    # The subtypes agree on the declared type (list[int]), so bidirectional
    # inference still applies and there should be no error here.
    x.a = []
    x.a = [1]
    reveal_type(x.a, expected_text="list[int]")


class E:
    e: int


class F:
    e: str


def func3(x: E | F):
    # The subtypes declare the member with unrelated types (int vs. str) rather
    # than differing type arguments of the same generic class. This is not the
    # false-positive scenario, so behavior is unchanged: assigning a value that
    # is incompatible with one of the subtypes still errors, and the error is
    # reported on the assigned expression (so an inline suppression continues to
    # work).

    # This should generate an error because "int" is not assignable to F.e.
    x.e = 1

    # An inline suppression on the assigned value still applies, confirming the
    # error is not relocated by dropping the expected type.
    x.e = 1  # type: ignore
