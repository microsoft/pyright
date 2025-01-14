# This sample tests the reportIncompatibleMethodOverride
# diagnostic check.

from typing import (
    Any,
    Callable,
    Generic,
    Iterable,
    ParamSpec,
    Sequence,
    TypedDict,
    TypeVar,
    overload,
)

T_ParentClass = TypeVar("T_ParentClass", bound="ParentClass")

P = ParamSpec("P")
T = TypeVar("T")
S = TypeVar("S")
U = TypeVar("U", bound=int)


def decorator(func: Callable[P, None]) -> Callable[P, int]: ...


class ParentClass:
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

    def my_method12(self, a: int | str) -> int | str:
        return 1

    def my_method13(self, a: int) -> int:
        return 1

    def my_method14(self, a: int) -> int:
        return 1

    def my_method15(self, a: int) -> int:
        return 1

    def my_method16(self, a: int) -> int:
        return 1

    def my_method17(self, a: str, b: int, c: float, d: bool) -> None: ...

    def my_method18(self, a: str, b: int, c: float, d: bool) -> None: ...

    def my_method19(self, a: str, b: int, c: float, d: bool) -> None: ...

    @classmethod
    def my_method20(cls: type[T_ParentClass], a: str) -> T_ParentClass: ...

    def my_method21(self, var: int) -> None: ...

    def _protected_method1(self, a: int):
        return 1

    def __private_method1(self, a: int):
        return 1

    def my_method22(self, a: str, b: int, c: float, d: bool) -> None: ...

    def my_method23(self, a: str = "") -> None: ...

    def my_method24(self, a: str) -> None: ...

    def my_method25(self, *, a: str = "") -> None: ...

    def my_method26(self, *, a: str) -> None: ...

    def my_method27(self, a: object, /) -> None: ...

    def my_method28(self, __a: object) -> None: ...

    @classmethod
    def my_method29(cls, /) -> None: ...

    @classmethod
    def my_method30(cls, /) -> None: ...

    @staticmethod
    def my_method31(a: "type[ParentClass]", /) -> None: ...

    @staticmethod
    def my_method32(a: "type[ParentClass]", /) -> None: ...

    def my_method33(self, /) -> None: ...

    def my_method34(self, /) -> None: ...

    def my_method35(self, *, a: int) -> None: ...

    def my_method36(self, *, a: int) -> None: ...

    def my_method37(self, a: int, /) -> None: ...

    def my_method38(self, a: int, /) -> None: ...

    def my_method39(self, a: int, /) -> None: ...

    def my_method40(self, a: int, /) -> None: ...

    def my_method41(self, a: int, b: str, c: str) -> None: ...

    def my_method42(self, a: int, b: int, c: str) -> None: ...

    my_method43: Callable[..., None]

    def my_method44(self, *args: object, **kwargs: object) -> None: ...

    def my_method45(self, __i: int) -> None: ...

    def __my_method46__(self, x: int) -> None: ...

    def __my_method47__(self, x: int) -> None: ...


T_ChildClass = TypeVar("T_ChildClass", bound="ChildClass")


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

    def my_method10(self, a: int, b: int, *args):
        return 1

    def my_method11(self, a: int, b: int, *, c: str = "", **kwargs):
        return 1

    # This should generate an error because the type of 'a' is
    # narrower than the original method.
    def my_method12(self, a: int) -> int:
        return 1

    def my_method13(self, a: int | str) -> int:
        return 1

    # This should generate an error because the return type is
    # wider than in the original method.
    def my_method14(self, a: int) -> int | str:
        return 1

    # This should generate an error because we're overriding a
    # method with a variable.
    my_method15: int = 3

    # This should generate an error because we're overriding a
    # method with a class.
    class my_method16:
        pass

    def my_method17(self, *args: object, **kwargs: object) -> None: ...

    def my_method18(self, a: str, *args: object, **kwargs: object) -> None: ...

    # This should generate an error because b param doesn't match a in name.
    def my_method19(self, b: str, *args: object, **kwargs: object) -> None: ...

    @classmethod
    def my_method20(cls: type[T_ChildClass], a: str) -> T_ChildClass: ...

    # This should generate an error.
    @decorator
    def my_method21(self, var: int) -> None: ...

    # This should generate an error.
    def _protected_method1(self):
        return 1

    def __private_method1(self):
        return 1

    # This should generate an error.
    def my_method22(self, a: str, b: int, c: float, d: bool, /) -> None: ...

    # This should generate an error because a is missing a default value.
    def my_method23(self, a: str) -> None: ...

    def my_method24(self, a: str = "") -> None: ...

    # This should generate an error because a is missing a default value.
    def my_method25(self, *, a: str) -> None: ...

    def my_method26(self, *, a: str = "") -> None: ...

    def my_method27(self, __a: object) -> None: ...

    def my_method28(self, a: object, /) -> None: ...

    # This should generate an error because it is not a classmethod.
    def my_method29(self, /) -> None: ...

    # This should generate an error because it is not a classmethod.
    @staticmethod
    def my_method30(a: type[ParentClass], /) -> None: ...

    # This should generate an error because it is not a staticmethod.
    @classmethod
    def my_method31(cls, /) -> None: ...

    # This should generate an error because it is not a staticmethod.
    def my_method32(self, /) -> None: ...

    # This should generate an error because it is not an instance method.
    @classmethod
    def my_method33(cls, /) -> None: ...

    # This should generate an error because it is not an instance method.
    @staticmethod
    def my_method34(a: type[ParentClass], /) -> None: ...

    def my_method35(self, **kwargs: int) -> None: ...

    # This should generate an error because the method in the parent
    # class has a keyword-only parameter that is type 'int', and this
    # isn't compatible with 'str'.
    def my_method36(self, **kwargs: str) -> None: ...

    def my_method37(self, *args: Any) -> None: ...

    # This should generate an error because the number of position-only
    # parameters doesn't match.
    def my_method38(self, **kwargs: Any) -> None: ...

    def my_method39(self, *args: Any) -> None: ...

    # This should generate an error because the number of position-only
    # parameters doesn't match.
    def my_method40(self, **kwargs: Any) -> None: ...

    # This should generate an error because keyword parameters "a"
    # and "b" are missing.
    def my_method41(self, a: int, *args: str) -> None: ...

    # This should generate an error because args doesn't have the right type.
    def my_method42(self, a: int, *args: int) -> None: ...

    def my_method43(self, a: int, b: str, c: str) -> None: ...

    # This should generate an error because kwargs is missing.
    def my_method44(self, *object) -> None: ...

    def my_method45(self, i: int, /) -> None: ...

    def __my_method46__(self, y: int) -> None: ...

    # This should generate an error because of a type mismatch.
    def __my_method47__(self, y: str) -> None: ...


class A:
    def test(self, t: Sequence[int]) -> Sequence[str]: ...


class GeneralizedArgument(A):
    def test(self, t: Iterable[int], bbb: str = "") -> Sequence[str]: ...


class NarrowerArgument(A):
    # This should generate error because list[int] is narrower
    # than Iterable[int].
    def test(self, t: list[int]) -> Sequence[str]: ...


class NarrowerReturn(A):
    def test(self, t: Sequence[int]) -> list[str]: ...


class GeneralizedReturn1(A):
    # This should generate an error because Iterable[str] is
    # wider than Sequence[str].
    def test(self, t: Sequence[int]) -> Iterable[str]: ...


class GeneralizedReturn2(A):
    # This should generate an error because list[int] is
    # incompatible with Sequence[str].
    def test(self, t: Sequence[int]) -> list[int]: ...


_T1 = TypeVar("_T1")
_T2 = TypeVar("_T2")


class Base1:
    def submit(self, fn: Callable[..., _T1], *args: Any, **kwargs: Any) -> list[_T1]:
        return []


class Base2(Base1):
    def submit(self, fn: Callable[..., _T2], *args: Any, **kwargs: Any) -> list[_T2]:
        return []


class Foo:
    pass


_T2A = TypeVar("_T2A", bound=Foo)
_T2B = TypeVar("_T2B", bound=Foo)


class ClassA(Generic[_T2A]):
    def func1(self) -> _T2A | None:
        return None

    @property
    def prop1(self) -> _T2A | None:
        return None

    @property
    def prop2(self) -> _T2A | None:
        return None

    @prop2.setter
    def prop2(self, val: _T2A):
        pass

    @prop2.deleter
    def prop2(self):
        pass

    @property
    def prop3(self) -> _T2A | None:
        return None

    @prop3.setter
    def prop3(self, val: _T2A):
        pass

    @property
    def prop4(self) -> _T2A | None:
        return None

    @prop4.deleter
    def prop4(self):
        pass

    @property
    def prop5(self) -> int:
        return 3

    @property
    def prop6(self) -> int:
        return 3

    @prop6.setter
    def prop6(self, x: int) -> None:
        pass


class ClassB(ClassA[_T2B]):
    # This should generate an error because a variable
    # cannot override a property.
    prop1: _T2B

    def func1(self) -> _T2B | None:
        return None

    @property
    def prop2(self) -> _T2B:
        return self.prop1

    @prop2.setter
    def prop2(self, val: _T2B):
        pass

    @prop2.deleter
    def prop2(self):
        pass

    # This should generate an error because it is missing
    # a setter (fset method).
    @property
    def prop3(self) -> _T2B | None:
        return None

    # This should generate an error because it is missing
    # a deleter (fdel method).
    @property
    def prop4(self) -> _T2B | None:
        return None

    # This should generate an error because prop4's getter
    # method isn't compatible with base class.
    @property
    def prop5(self) -> str:
        return "hi"

    def func6(self):
        self.prop6 = 1


class Base3:
    def case(self, value: Any) -> Iterable[Any]:
        return []


class Derived3(Base3):
    @overload
    def case(self, value: int) -> Iterable[int]: ...

    @overload
    def case(self, value: float) -> Iterable[float]: ...

    def case(self, value: Any) -> Iterable[Any]:
        return []


class Base4:
    def a(self) -> int: ...


class Base5:
    def a(self) -> int: ...


class C(Base4, Base5):
    # This should generate two error if reportIncompatibleMethodOverride
    # is enabled.
    def a(self) -> float: ...


class MyObject(TypedDict):
    values: list[str]


class Base6(Generic["T"]):
    def method1(self, v: int) -> None: ...

    def method2(self, v: T) -> None: ...

    def method3(self, v: T) -> None: ...

    def method4(self, v: S) -> S: ...

    def method5(self, v: S) -> S: ...


class Derived6(Base6[int], Generic["T"]):
    # This should generate an error.
    def method1(self, v: T): ...

    # This should generate an error.
    def method2(self, v: T) -> None: ...

    def method3(self, v: int) -> None: ...

    def method4(self, v: T) -> T: ...

    def method5(self, v: S) -> S: ...


class Base7(Generic[T]):
    def method1(self, x: T) -> T:
        return x


class Derived7_1(Base7[T]):
    # This should generate an error.
    def method1(self, x: S) -> S:
        return x


class Derived7_2(Base7[int]):
    def method1(self, x: U) -> U:
        return x


class Base8[T]:
    def method1(self, x: T) -> T: ...


class Derived8[T](Base8[T]):
    # This should generate an error.
    def method1[U: str](self, x: U) -> U: ...
