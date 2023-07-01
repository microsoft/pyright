# This sample tests the handling of a constructor for a generic
# class where the type arguments need to be inferred using
# bidirectional type inference and the expected type is a
# union of other types.

from typing import Generic, TypeVar, Final

T = TypeVar("T")
E = TypeVar("E")


class Ok(Generic[T]):
    def __init__(self, value: T) -> None:
        self._value: Final = value


class Err(Generic[E]):
    def __init__(self, value: E) -> None:
        self._value: Final = value


Result = Ok[T] | Err[E]


def return_ok_none() -> Result[int | None, Exception]:
    return Ok(None)


def return_ok_one() -> Result[int | None, Exception]:
    return Ok(1)
