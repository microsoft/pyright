# This sample tests overload matching in cases where the match
# is ambiguous due to an Any or Unknown argument.

# pyright: reportMissingModuleSource=false

from typing import Any, Generic, Literal, TypeVar, overload
from typing_extensions import LiteralString, TypeIs

_T = TypeVar("_T")


@overload
def overload1(x: int, y: float) -> float: ...


@overload
def overload1(x: str, y: float) -> str: ...


def overload1(x: str | int, y: float) -> float | str: ...


def func1(a: Any):
    v1 = overload1(1, 3.4)
    reveal_type(v1, expected_text="float")

    v2 = overload1("", 3.4)
    reveal_type(v2, expected_text="str")

    v3 = overload1(a, 3.4)
    reveal_type(v3, expected_text="Unknown")

    v4 = overload1("", a)
    reveal_type(v4, expected_text="str")


@overload
def overload2(x: int) -> Any: ...


@overload
def overload2(x: str) -> str: ...


def overload2(x: str | int) -> Any | str: ...


def func2(a: Any):
    v1 = overload2("")
    reveal_type(v1, expected_text="str")

    v2 = overload2(3)
    reveal_type(v2, expected_text="Any")

    v3 = overload2(a)
    reveal_type(v3, expected_text="Any")


@overload
def overload3(x: LiteralString) -> LiteralString: ...


@overload
def overload3(x: str) -> str: ...


def overload3(x: str) -> str: ...


def func3(a: Any, b: str):
    v1 = overload3("")
    reveal_type(v1, expected_text="LiteralString")

    v2 = overload3(b)
    reveal_type(v2, expected_text="str")

    v3 = overload3(a)
    reveal_type(v3, expected_text="str")


def func4(a: Any):
    d = dict(a)
    reveal_type(d, expected_text="dict[Any, Any]")


@overload
def overload4(x: str, *, flag: Literal[True]) -> int: ...


@overload
def overload4(x: str, *, flag: Literal[False] = ...) -> str: ...


@overload
def overload4(x: str, *, flag: bool = ...) -> int | str: ...


def overload4(x: str, *, flag: bool = False) -> int | str: ...


reveal_type(overload4("0"), expected_text="str")
reveal_type(overload4("0", flag=True), expected_text="int")
reveal_type(overload4("0", flag=False), expected_text="str")


def unknown_any() -> Any: ...


def func5(a: Any):
    reveal_type(overload4(a, flag=False), expected_text="str")
    reveal_type(overload4("0", flag=a), expected_text="Unknown")


@overload
def overload5(x: list[int]) -> list[int]: ...


@overload
def overload5(x: list[str]) -> list[str]: ...


def overload5(x: list[str] | list[int]) -> list[str] | list[int]:
    return x


def func6(y: list[Any]):
    reveal_type(overload5(y), expected_text="list[int]")


class ClassA(Generic[_T]):
    @overload
    def m1(self: "ClassA[int]") -> "ClassA[int]": ...

    @overload
    def m1(self: "ClassA[str]") -> "ClassA[str]": ...

    def m1(self) -> "ClassA[Any]":
        return self


def func7(a: ClassA[Any]):
    reveal_type(a.m1(), expected_text="ClassA[int]")


class ClassB(Generic[_T]):
    @overload
    def m1(self: "ClassB[int]", obj: "int | ClassB[int]") -> "ClassB[int]": ...

    @overload
    def m1(self: "ClassB[str]", obj: "str | ClassB[str]") -> "ClassB[str]": ...

    def m1(self, obj: Any) -> "ClassB[Any]":
        return self


def func8(b: ClassB[Any]):
    reveal_type(b.m1(b), expected_text="ClassB[int]")


_T1 = TypeVar("_T1")
_T2 = TypeVar("_T2")


@overload
def overload6(a: _T1, /) -> tuple[_T1]: ...


@overload
def overload6(a: _T1, b: _T2, /) -> tuple[_T1, _T2]: ...


@overload
def overload6(*args: _T1) -> tuple[_T1, ...]: ...


def overload6(*args: Any) -> tuple[Any, ...]:
    return tuple(args)


def func9(*args: int):
    reveal_type(overload6(*args), expected_text="tuple[int, ...]")


@overload
def overload7(a: float = ..., *, b: Literal[True] = ...) -> float: ...


@overload
def overload7(a: float = ..., *, b: bool) -> str: ...


def overload7(a: float = 1.0, *, b: bool = True) -> float | str: ...


def func10(kwargs_dict: dict[Any, Any]):
    reveal_type(overload7(**kwargs_dict), expected_text="Unknown")


def func11(kwargs_dict: dict[str, Any]):
    reveal_type(overload7(**kwargs_dict), expected_text="Unknown")


def func12(kwargs_dict: dict[str, bool]):
    reveal_type(overload7(**kwargs_dict), expected_text="str")


def func13(kwargs_dict: dict[str, Literal[True]]):
    reveal_type(overload7(**kwargs_dict), expected_text="float")


def func14():
    reveal_type(overload7(), expected_text="float")


def func15(kwargs_dict: dict[str, str]):
    # This should generate an error because str isn't a valid type for
    # the b parameter.
    overload7(1.0, **kwargs_dict)


@overload
def overload8(x: int = 3, **kwargs: int) -> int: ...


@overload
def overload8(**kwargs: str) -> str: ...


def overload8(*args, **kwargs) -> Any:
    pass


def func16(a: dict[str, Any], i: int):
    reveal_type(overload8(x=i, **a), expected_text="int")
    reveal_type(overload8(**a), expected_text="Unknown")


@overload
def overload9(x: int, y: int) -> int: ...


@overload
def overload9(x: float, y: int, z: str) -> float: ...


@overload
def overload9(x: object, y: int, z: str, a: None) -> str: ...


def overload9(x, y, z="", a=None) -> Any:
    pass


def func17(a: Any):
    reveal_type(overload9(*a), expected_text="Unknown")
    reveal_type(overload9(a, *a), expected_text="Unknown")
    reveal_type(overload9(1, *a), expected_text="Unknown")
    reveal_type(overload9(1.1, *a), expected_text="Unknown")
    reveal_type(overload9("", *a), expected_text="str")


@overload
def overload10(x: list[int]) -> list[int]: ...


@overload
def overload10(x: list[Any]) -> list[Any]: ...


def overload10(x) -> Any:
    pass


def func18(a: Any, b: list[Any], c: list[str], d: list[int]):
    reveal_type(overload10(a), expected_text="list[int]")
    reveal_type(overload10(b), expected_text="list[int]")
    reveal_type(overload10(c), expected_text="list[Any]")
    reveal_type(overload10(d), expected_text="list[int]")


class ClassC:
    @overload
    def method1(self, k: Literal["hi"], default: Any) -> float: ...

    @overload
    def method1(self, k: str, default: _T) -> Any | _T: ...

    def method1(self, k: str, default: _T) -> Any | _T: ...


def func19(a: ClassC, b: list, c: Any):
    my_list1: list = []
    v1 = a.method1("hi", my_list1)
    reveal_type(v1, expected_text="float")

    v2 = a.method1("hi", b)
    reveal_type(v2, expected_text="float")

    v3 = a.method1("hi", c)
    reveal_type(v3, expected_text="float")

    my_list2: list[int] = []
    v1 = a.method1("hi", my_list2)
    reveal_type(v1, expected_text="float")


@overload
def overload11(x: str) -> TypeIs[str]: ...


@overload
def overload11(x: int) -> TypeIs[int]: ...


def overload11(x: Any) -> Any:
    return True


def func20(val: Any):
    if overload11(val):
        reveal_type(val, expected_text="Any")
