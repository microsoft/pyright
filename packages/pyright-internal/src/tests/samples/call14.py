# This sample tests the pre-3.8 position-only parameter convention.


from typing import Any


def func1(__a: int, __b: int, c: int) -> None: ...


func1(1, 2, c=3)

# This should generate an error because __b is position-only.
func1(1, __b=2, c=3)


# This should generate an error because a position-only parameter cannot
# follow a non-position-only parameter.
def func2(a: int, __b: int) -> None: ...


def func3(a: int, *args: Any, __b: int) -> None: ...


func3(a=1, __b=2)


def func4(a: int, /, __b: int) -> None: ...


func4(1, __b=2)


class A:
    def m1(self, __a: int, b: int) -> None:
        pass

    # This should generate an error.
    def m2(self, a: int, __b: int) -> None:
        pass

    @classmethod
    def c1(cls, __a, int, b: int) -> None:
        pass

    @classmethod
    # This should generate an error.
    def c2(cls, a, int, __b: int) -> None:
        pass

    @staticmethod
    def s1(__a: int, b: int) -> None:
        pass

    @staticmethod
    # This should generate an error.
    def s2(a: int, __b: int) -> None:
        pass
