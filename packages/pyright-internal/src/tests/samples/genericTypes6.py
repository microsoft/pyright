# This sample tests the type checker's ability to do
# TypeVar matching for both constrained TypeVars and unconstrained.

from typing import Generic, Literal, TypeVar

S = TypeVar("S", str, bytes)


def constrained(first: S, second: S) -> S:
    return first


# This should generate an error because the two arguments
# cannot satisfy the 'str' or 'bytes' constraint.
result = constrained("a", b"abc")

T = TypeVar("T")


def unconstrained(first: T, second: T) -> T:
    return first


# This shouldn't generate an error because the TypeVar matching
# logic is free to expand the type to a union of 'str' and 'bytes'.
result = unconstrained("a", b"abc")


U = TypeVar("U", int, str)


class Foo(Generic[U]):
    def generic_func1(self, a: U, b: U = ..., **kwargs: U) -> U:
        return b


foo = Foo[str]()
r1 = foo.generic_func1("hi")
t1: Literal["str"] = reveal_type(r1)
r2 = foo.generic_func1("hi", test="hi")
t2: Literal["str"] = reveal_type(r2)

# This should generate an error.
r3 = foo.generic_func1("hi", test=3)
t3: Literal["str"] = reveal_type(r3)

# This should generate an error.
r4 = foo.generic_func1("hi", 3)
t4: Literal["str"] = reveal_type(r4)
