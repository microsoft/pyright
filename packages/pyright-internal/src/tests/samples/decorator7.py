# This sample tests the case where a class decorator needs to evaluate
# the type of __init__ prior to the class being fully evaluated.

from typing import Any, Callable, Generic, TypeVar

T = TypeVar("T")
FuncType = Callable[..., Any]
FT = TypeVar("FT", bound=FuncType)


def decorate() -> Callable[[FT], FT]: ...


@decorate()
class ValueDecorated(Generic[T]):
    def __init__(self, value: T) -> None:
        self._value: T = value

    def __call__(self) -> T:
        return self._value
