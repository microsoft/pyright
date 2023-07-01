# This sample tests the case where a generic type alias is specialized
# with an instantiable class rather than a class instance.

from typing import TypeVar, Sequence

T = TypeVar("T", bound=type[Exception])
MaybeSequence = T | Sequence[T]


class HttpError(Exception):
    pass


def func1(errs: MaybeSequence[type[Exception]]):
    pass


func1(HttpError)
func1(Exception)

reveal_type(
    MaybeSequence[type[HttpError]],
    expected_text="type[type[HttpError]] | type[Sequence[type[HttpError]]]",
)
