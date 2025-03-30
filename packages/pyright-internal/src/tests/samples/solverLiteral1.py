# This sample tests the case that exercises some of the heuristics that
# determine whether a solved TypeVar should retain a literal type.

from typing import Callable, Generic, Literal, TypeVar

FileChanges = dict[str, Literal["created", "edited", "removed"]]

changes: FileChanges = {}
changes.update({filename: "removed" for filename in ["foo.py", "bar.py"]})

_S = TypeVar("_S")
_T = TypeVar("_T")


class ClassA(Generic[_T]):
    pass


TA1 = Callable[[ClassA[_T]], None]


def func1(value: _T) -> TA1[_T]:
    def ret(ctx: ClassA[_T]) -> None:
        pass

    return ret


def func2() -> TA1[bool]:
    return func1(True)


def func3(value: _T) -> Callable[[_T], None]: ...


x: Callable[[tuple[bool]], None] = func3((True,))


def func4(v: _T, f: Callable[[_T], None]): ...


def func5(v: Literal[1, 2], f: Callable[[Literal[1, 2]], None]):
    func4(v, f)


class ClassB(Generic[_S, _T]):
    left: _S
    right: _T


def func6(s: _S, t: _T) -> ClassB[_S, _T]: ...


def func7(t: _T, f: Callable[[ClassB[_T, Literal[2]]], None]) -> None:
    return f(func6(t, 2))


def func8(a: _T, b: Callable[[list[_T]], None]) -> _T:
    return a


def func9(v: Callable[[list[int]], None]):
    func8(b=v, a=1)

    func8(a=1, b=v)
