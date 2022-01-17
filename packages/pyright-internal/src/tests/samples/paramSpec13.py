# This sample tests cases where a ParamSpec is used as a type parameter
# for a generic type alias, a generic function, and a generic class.

from typing import Callable, Concatenate, Generic, List, ParamSpec, TypeVar


_P = ParamSpec("_P")
_R = TypeVar("_R")
_T = TypeVar("_T")


AddIntParam = Callable[Concatenate[int, _P], _T]


def func1(func: Callable[_P, _R]) -> AddIntParam[_P, _R]:
    ...


def func2(a: str, b: List[int]) -> str:
    ...


v1 = func1(func2)
reveal_type(v1, expected_text="(int, a: str, b: List[int]) -> str")

# This should generate an error because 'int' isn't assignable to
# ParamSpec _P.
X = AddIntParam[int, int]


class RemoteResponse(Generic[_T]):
    ...


class RemoteFunction(Generic[_P, _R]):
    def __init__(self, func: Callable[_P, _R]) -> None:
        ...

    def __call__(self, *args: _P.args, **kwargs: _P.kwargs) -> _R:
        ...

    def remote(self, *args: _P.args, **kwargs: _P.kwargs) -> RemoteResponse[_R]:
        ...


r1 = RemoteFunction(func2)
reveal_type(r1, expected_text="RemoteFunction[(a: str, b: List[int]), str]")

v2 = r1("hi", [])
reveal_type(v2, expected_text="str")

v3 = r1.remote("hi", [])
reveal_type(v3, expected_text="RemoteResponse[str]")

# This should generate an error
r1(1, [])

# This should generate an error
r1("hi")

# This should generate an error
r1.remote(1, [])

# This should generate an error because 'int' is not assignable
# to ParamSpec _P.
A = RemoteFunction[int, int]


def remote(func: Callable[_P, _R]) -> RemoteFunction[_P, _R]:
    ...


v4 = remote(func2)
reveal_type(v4, expected_text="RemoteFunction[(a: str, b: List[int]), str]")
