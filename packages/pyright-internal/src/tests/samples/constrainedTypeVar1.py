# This sample tests constraint solving constrained TypeVars.

from typing import Generic, TypeVar

S = TypeVar("S", str, bytes)


def constrained(first: S, second: S) -> S:
    return first


# This should generate an error because the two arguments
# cannot satisfy the 'str' or 'bytes' constraint.
result = constrained("a", b"abc")

U = TypeVar("U", float, str)


class ClassA(Generic[U]):
    def generic_func1(self, a: U, b: str = "", **kwargs: U) -> U:
        return a


a1 = ClassA[str]()
r1 = a1.generic_func1("hi")
reveal_type(r1, expected_text="str")
r2 = a1.generic_func1("hi", test="hi")
reveal_type(r2, expected_text="str")

# This should generate an error.
r3 = a1.generic_func1("hi", test=3)
reveal_type(r3, expected_text="str")

# This should generate an error.
r4 = a1.generic_func1("hi", 3)
reveal_type(r4, expected_text="str")

a2: ClassA[int]

# This should generate an error.
a3: ClassA[Never]

ClassAAlias = ClassA[U]

# This should generate an error.
a4: ClassAAlias[Never]
