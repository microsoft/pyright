# This sample tests the case where a generic type alias is specialized
# with an instantiable class rather than a class instance.

from typing import TypeVar, Sequence, Type

_T = TypeVar("_T", bound=Type[Exception])
_MaybeSequence = _T | Sequence[_T]


class HttpError(Exception):
    pass


def func1(errs: _MaybeSequence[type[Exception]]):
    pass


func1(HttpError)
func1(Exception)

reveal_type(
    _MaybeSequence[type[HttpError]],
    expected_text="Type[Type[HttpError]] | Type[Sequence[Type[HttpError]]]",
)
