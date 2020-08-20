# This sample tests the reportIncompatibleMethodOverride
# configuration option.

from typing import Iterable, List, Sequence, Union


class ParentClass():
    def my_method1(self, a: int):
        return 1

    def my_method2(self, a: int, b: int):
        return 1

    def my_method3(self, a: int, b: int):
        return 1

    def my_method4(self, a: int, *b: int):
        return 1

    def my_method5(self, a: int, _b: int):
        return 1

    def my_method6(self, a: int, /, b: int):
        return 1

    def my_method7(self, a: int, /, b: int):
        return 1

    def my_method8(self, a: int, b: int):
        return 1

    def my_method9(self, a: int, b: int):
        return 1

    def my_method10(self, a: int, b: int):
        return 1

    def my_method11(self, a: int, b: int):
        return 1

    def my_method12(self, a: Union[int, str]) -> Union[int, str]:
        return 1

    def my_method13(self, a: int) -> int:
        return 1

    def my_method14(self, a: int) -> int:
        return 1

    def my_method15(self, a: int) -> int:
        return 1

    def my_method16(self, a: int) -> int:
        return 1

class ChildClass(ParentClass):
    # This should generate an error because the type of 'a' doesn't match.
    def my_method1(self, a: str):
        return 1

    # This should generate an error because it's missing a param named 'b'.
    def my_method2(self, a: int):
        return 1

    # This should generate an error because the name doesn't match.
    def my_method3(self, a: int, c: int):
        return 1

    # This should generate an error because the param category for 'b'
    # doesn't match.
    def my_method4(self, a: int, **b: int):
        return 1

    def my_method5(self, a: int, _c: int):
        return 1

    def my_method6(self, not_a: int, /, b: int):
        return 1

    # This should generate an error because c is not a position-only parameter.
    def my_method7(self, a: int, /, c: int):
        return 1

    # This should generate an error because it contains too many parameters.
    def my_method8(self, a: int, b: int, c: int, d: str = ""):
        return 1

    def my_method9(self, a: int, b: int, c: int = 4):
        return 1

    def my_method10(self, a: int, b: int, *varg):
        return 1

    def my_method11(self, a: int, b: int, *, c: str = "", **kwarg):
        return 1

    def my_method12(self, a: str) -> int:
        return 1

    # This should generate an error because the type of 'a' is
    # wider than in the original method.
    def my_method13(self, a: Union[int, str]) -> int:
        return 1

    # This should generate an error because the return type is
    # wider than in the original method.
    def my_method14(self, a: int) -> Union[int, str]:
        return 1

    # This should generate an error because we're overriding a
    # method with a variable.
    my_method15 = 3

    # This should generate an error because we're overriding a
    # method with a class.
    class my_method16:
        pass



class A:
    def test(self, t: Sequence[int]) -> Sequence[str]:
        ...


class GeneralizedArgument(A):
    def test(self, t: Iterable[int], bbb: str = "") -> Sequence[str]:
        ...


class NarrowerArgument(A):
    # This should generate error because List[int] is narrower
    # than Iterable[int].
    def test(self, t: List[int]) -> Sequence[str]:
        ...


class NarrowerReturn(A):
    def test(self, t: Sequence[int]) -> List[str]:
        ...


class GeneralizedReturn1(A):
    # This should generate an error because Iterable[str] is
    # wider than Sequence[str].
    def test(self, t: Sequence[int]) -> Iterable[str]:
        ...

class GeneralizedReturn2(A):
    # This should generate an error because List[int] is
    # incompatible with Sequence[str].
    def test(self, t: Sequence[int]) -> List[int]:
        ...

