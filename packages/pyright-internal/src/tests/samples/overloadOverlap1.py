# This sample tests the type checker's detection of overlapping
# overload declarations.

from typing import (
    Any,
    AnyStr,
    Callable,
    Concatenate,
    Generic,
    Literal,
    ParamSpec,
    Protocol,
    Sequence,
    TypeVar,
    overload,
)

_T1 = TypeVar("_T1")
_T2 = TypeVar("_T2")
_P = ParamSpec("_P")


@overload
def func1(a: float, b: float | None, c: bool | None = None) -> int: ...


# This should generate an error because the overload is obscured.
@overload
def func1(a: int, b: int) -> int: ...


@overload
def func1(a: int, b: int, *, named: int = 3) -> int: ...


# This should generate an error because the overload is obscured.
@overload
def func1(a: int, b: int, *, named: int) -> int: ...


@overload
def func1(a: complex, b: int) -> int: ...


def func1(*args: Any, **kwargs: Any) -> Any:
    pass


@overload
def func2(a: int, b: Any) -> int:
    """Overload"""


# This should generate an error because the overload is obscured.
@overload
def func2(a: int, b: int) -> int:
    """Overload"""


def func2(*args: Any, **kwargs: Any) -> Any:
    pass


@overload
def func3(a: int, b: int) -> int: ...


@overload
def func3(a: int, b: int, **c: Any) -> int: ...


@overload
def func3(a: int, b: Any) -> int: ...


def func3(*args: Any, **kwargs: Any) -> Any:
    pass


@overload
def func4(a: int, *, c: int, b: int) -> int: ...


# This should generate an error because the overload is obscured.
@overload
def func4(a: int, *, b: int, c: int) -> int: ...


def func4(*args: Any, **kwargs: Any) -> Any:
    pass


# This should generate an error because the overload is overlapping
# in an unsafe way (i.e. returns an incompatible type).
@overload
def func5(a: int, b: int) -> int: ...


@overload
def func5(a: float, b: float = 3.4, *c: int, d: float = 4.5) -> str: ...


def func5(*args: Any, **kwargs: Any) -> Any:
    pass


class GenericClass(Generic[_T1, _T2]):
    @overload
    def method1(self, a: _T1, b: tuple[_T2, ...]) -> int: ...

    @overload
    def method1(self, a: _T1, b: tuple[Any, ...]) -> int: ...

    def method1(self, *args: Any, **kwargs: Any) -> Any: ...

    @overload
    def method2(self, a: _T2, b: int) -> int: ...

    @overload
    def method2(self, a: _T1, b: _T2) -> int: ...

    def method2(self, *args: Any, **kwargs: Any) -> Any:
        pass


class Parent: ...


class Child(Parent): ...


# Test 1: Literal subtype


# This should generate an error because the overload is overlapping
# in an unsafe way (i.e. returns an incompatible type).
@overload
def func10(x: Literal[3]) -> int: ...


@overload
def func10(x: int) -> str: ...


def func10(*args: Any, **kwargs: Any) -> Any:
    pass


# Test 2: Subclass subtype


# This should generate an error because the overload is overlapping
# in an unsafe way (i.e. returns an incompatible type).
@overload
def func11(x: Child) -> str: ...


@overload
def func11(x: Parent) -> int: ...


def func11(*args: Any, **kwargs: Any) -> Any:
    pass


# Test 3: Implicit subtype


# This should generate an error because the overload is overlapping
# in an unsafe way (i.e. returns an incompatible type).
@overload
def func12(x: int) -> str: ...


@overload
def func12(x: float) -> int: ...


def func12(*args: Any, **kwargs: Any) -> Any:
    pass


# Test 4: Union subtype


# This should generate an error because the overload is overlapping
# in an unsafe way (i.e. returns an incompatible type).
@overload
def func13(x: int) -> str: ...


@overload
def func13(x: int | str) -> int: ...


def func13(*args: Any, **kwargs: Any) -> Any:
    pass


# Test 5: non-matching keyword argument


# This should generate an error because the overload is overlapping
# in an unsafe way (i.e. returns an incompatible type).
@overload
def func14(x: int, *, cls: str, **kwargs: Any) -> int: ...


@overload
def func14(x: int, **kwargs: Any) -> str: ...


def func14(*args: Any, **kwargs: Any) -> Any:
    pass


# Test 6: non-matching keyword argument (shouldn't generate error)
@overload
def func15(cls: str, **kwargs: Any) -> int: ...


@overload
def func15(**kwargs: Any) -> str: ...


def func15(*args: Any, **kwargs: Any) -> Any:
    pass


@overload
def func16(var: None) -> list[Any]: ...


@overload
def func16(var: _T1) -> list[_T1]: ...


def func16(var: _T1 | None) -> list[_T1] | list[Any]: ...


@overload
def func17(a: int, b: list[int]) -> int: ...


@overload
def func17(a: int, b: list[_T1]) -> _T1: ...


def func17(*args: Any, **kwargs: Any) -> Any:
    pass


class ClassA(Generic[_T1]):
    @overload
    def __call__(self, f: _T1) -> _T1: ...

    @overload
    def __call__(self, f: _T1 | None) -> _T1: ...

    def __call__(self, f: _T1 | None) -> _T1: ...


class ClassB:
    @overload
    def method1(self, x: type[Any]) -> bool: ...

    @overload
    def method1(self, x: Any) -> str | bool: ...

    def method1(self, x: Any) -> Any: ...


class ClassC:
    @overload
    def method1(self, x: type) -> bool: ...

    @overload
    def method1(self, x: Any) -> str | bool: ...

    def method1(self, x: Any) -> Any: ...


@overload
def func18(s: Sequence[_T1], extra: Literal[False]) -> list[_T1]: ...


@overload
def func18(s: Sequence[_T1], extra: Literal[True]) -> list[_T1] | tuple[_T1]: ...


@overload
def func18(s: Sequence[_T1], extra: bool) -> list[_T1] | tuple[_T1]: ...


def func18(s: Sequence[_T1], extra: bool) -> list[_T1] | tuple[_T1]: ...


class DProto1(Protocol):
    def __radd__(self, other: Any, /) -> Any: ...


class DProto2(Protocol):
    def __radd__(self: _T1, other: Any, /) -> _T1: ...


@overload
def func19(a: Any, b: DProto2) -> DProto2: ...


@overload
def func19(a: Any, b: DProto1) -> Any: ...


def func19(a: Any, b: Any) -> Any:
    return a + b


AllStr = bytes | str


@overload
def func20(choices: AnyStr) -> AnyStr: ...


@overload
def func20(choices: AllStr) -> AllStr: ...


def func20(choices: AllStr) -> AllStr: ...


# This should generate an overlapping overload error.
@overload
def func21(self, p1: int | set[int], /) -> str: ...


@overload
def func21(self, p1: int | list[int], /) -> int: ...


def func21(self, p1: int | set[int] | list[int], /) -> str | int:
    return ""


@overload
def func22(self, p1: str | set[int], /) -> str: ...


@overload
def func22(self, p1: int | list[int], /) -> int: ...


def func22(self, p1: str | int | set[int] | list[int], /) -> str | int:
    return ""


@overload
def func23(f: Callable[Concatenate[_T1, _P], _T2]) -> int: ...


@overload
def func23(f: Callable[_P, _T2]) -> int: ...


def func23(f: Any) -> int:
    return 1


class E1: ...


TE1 = TypeVar("TE1", bound=E1)


class E2(E1, Generic[TE1]): ...


class E3(E1): ...


TE3 = TypeVar("TE3", bound=E3)


class E4(E1): ...


class ClassE(E2[E4], Generic[TE1]):
    @overload
    def unpack(self: "ClassE[E2[TE3]]") -> Sequence[TE3]: ...

    @overload
    def unpack(self) -> Sequence[Any]: ...

    def unpack(self) -> Sequence[Any]: ...


@overload
def func24(f: Callable[[int], str]) -> int: ...


@overload
def func24(f: Callable[[_T1], str]) -> float: ...


def func24(f: Any) -> Any:
    return f


_TInt = TypeVar("_TInt", bound=int)


@overload
def func25(val: _TInt) -> list[_TInt]: ...


@overload
def func25(val: str) -> int: ...


def func25(val: Any) -> Any: ...


@overload
def func26(val: _T1) -> list[_T1]: ...


# This should generate an error because it will never be used.
@overload
def func26(val: str) -> int: ...


def func26(val: Any) -> Any: ...


@overload
# This should generate an error because it is partially overlapping.
def func27(bar: None = ...) -> None: ...
@overload
def func27(bar: bool = ...) -> bool: ...
def func27(bar: bool | None = None) -> bool | None: ...


@overload
# This should generate an error because it is partially overlapping.
def func28(a: int, /, b: None = ...) -> None: ...
@overload
def func28(a: int, /) -> bool: ...
def func28(a: int, /, b: bool | None = None) -> bool | None: ...


class CBProto29(Protocol):
    def __call__(self, *args: Any) -> Any: ...


@overload
def func29(func: CBProto29) -> None: ...


@overload
def func29(func: Callable[..., Any]) -> None: ...


def func29(func: Any) -> None: ...


class CBProto30(Protocol):
    def __call__(self, *args: Any, **kwargs: Any) -> Any: ...


@overload
def func30(func: CBProto30) -> None: ...


@overload
# This should generate an error because this overload will never be used.
def func30(func: Callable[..., Any]) -> None: ...


def func30(func: Any) -> None: ...
