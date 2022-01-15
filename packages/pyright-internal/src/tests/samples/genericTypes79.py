# This sample tests the case that exercises some of the heuristics that
# determine whether TypeVar matching should retain a literal type.

from typing import Callable, Dict, Generic, Literal, Tuple, TypeVar


FileChanges = Dict[str, Literal["created", "edited", "removed"]]

changes: FileChanges = {}
changes.update({filename: "removed" for filename in ["foo.py", "bar.py"]})

_T = TypeVar("_T")


class IAsyncContext(Generic[_T]):
    pass


Async = Callable[[IAsyncContext[_T]], None]


def func1(value: _T) -> Async[_T]:
    def ret(ctx: IAsyncContext[_T]) -> None:
        pass

    return ret


def func2() -> Async[bool]:
    return func1(True)


def func3(value: _T) -> Callable[[_T], None]:
    ...


x: Callable[[Tuple[bool]], None] = func3((True,))
