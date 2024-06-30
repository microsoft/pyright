# This sample tests the case where a generic function returns a generic
# Callable. There are certain cases where we want the type variables in
# the return type to be rescoped to the return callable.

from typing import Callable, TypeVar


_T1 = TypeVar("_T1")


def func1(a: _T1 | None) -> Callable[[_T1], _T1]: ...


v1 = func1(None)
reveal_type(v1, expected_text="(Unknown) -> Unknown")


def func2(a: None) -> Callable[[_T1], _T1]: ...


v2 = func2(None)
reveal_type(v2, expected_text="(_T1@func2) -> _T1@func2")


def func3(a: None) -> Callable[[type[_T1]], type[_T1]]: ...


v3 = func3(None)
reveal_type(v3, expected_text="(type[_T1@func3]) -> type[_T1@func3]")
