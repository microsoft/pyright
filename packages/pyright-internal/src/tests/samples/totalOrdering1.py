# This sample tests the support for functools.total_ordering.

from functools import total_ordering


@total_ordering
class ClassA:
    val1: int

    def __gt__(self, other: object) -> bool: ...


a = ClassA()
b = ClassA()
v1 = a < b
v2 = a <= b
v3 = a > b
v4 = a >= b
v5 = a == b
v6 = a != b


# This should generate an error because it doesn't declare
# any of the required ordering functions.
@total_ordering
class ClassB:
    val1: int


@total_ordering
class ClassC:
    def __eq__(self, other: object) -> bool:
        return False

    def __lt__(self, other: "ClassC") -> bool:
        return False


reveal_type(ClassC() < ClassC(), expected_text="bool")
reveal_type(ClassC() <= ClassC(), expected_text="bool")
reveal_type(ClassC() == ClassC(), expected_text="bool")
reveal_type(ClassC() > ClassC(), expected_text="bool")
reveal_type(ClassC() >= ClassC(), expected_text="bool")

_ = ClassC() == 1
_ = ClassC() != 1

# The following four lines should each produce an error.
_ = ClassC() < 1
_ = ClassC() <= 1
_ = ClassC() > 1
_ = ClassC() >= 1


@total_ordering
class ClassD:
    def __init__(self) -> None:
        self.value: int = 0

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, ClassD):
            return NotImplemented

        reveal_type(other, expected_text="ClassD")

        return self.value == other.value

    def __le__(self, other: object) -> bool:
        if not isinstance(other, ClassD):
            return NotImplemented

        return self.value <= other.value
