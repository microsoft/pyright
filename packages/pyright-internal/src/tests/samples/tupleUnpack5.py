# This sample tests cases where an unpacked tuple is used in
# an overload.


from typing import Callable, Concatenate, overload


@overload
def func1[**P, R](func: Callable[P, R], /, *args: *tuple[()]) -> Callable[P, R]: ...
@overload
def func1[**P, R](
    func: Callable[Concatenate[int, P], R], /, *args: *tuple[int]
) -> Callable[P, R]: ...
@overload
def func1[**P, R](
    func: Callable[Concatenate[int, int, P], R], /, *args: *tuple[int, int]
) -> Callable[P, R]: ...


def func1[**P, R](func: Callable[..., R], /, *args: object) -> Callable[..., R]: ...


@overload
def func2(*args: *tuple[int]) -> int: ...
@overload
def func2(*args: *tuple[int, int, int]) -> int: ...


def func2(*args: *tuple[int, *tuple[int, ...]]) -> int: ...
