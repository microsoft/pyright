# This sample tests the handling of the "or" and "and" operators
# when used with bidirectional type inference.


from typing import Any, TypeVar, overload

_T = TypeVar("_T", bound=str)


@overload
def func1(cmd: _T) -> _T: ...


@overload
def func1(cmd: bytes) -> None: ...


def func1(cmd: Any) -> Any: ...


def func2(x: bool):
    y = x or func1("")
    reveal_type(y, expected_text="str | Literal[True]")


def func3(x: list[str]):
    y = x or []
    reveal_type(y, expected_text="list[str]")


def func4(x: set[str]):
    y = x or []
    reveal_type(y, expected_text="set[str] | list[Any]")


def identity(v: _T) -> _T:
    return v


def func5(x: int):
    v = x and identity("")
    reveal_type(v, expected_text="str | Literal[0]")
