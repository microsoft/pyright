# This sample tests the case where a base class has
# an unknown type and the type is used in an
# isinstance check.

# pyright: reportUnnecessaryIsInstance=true

from typing import TypeVar, Union

# This should generate an error because "dummy" can't be resolved.
# The symbol Document should have an unknown type.
from dummy import Document


class DbModel(Document):
    pass


def func1() -> Union[int, DbModel]:
    return DbModel()


# This should not generate an error even though DbModel is
# derived from an unknown base class.
isinstance(func1(), int)


def func2(obj: object, typ: type):
    return isinstance(obj, typ)


def func3(obj: float):
    if isinstance(obj, float):
        reveal_type(obj, expected_text="float")
    else:
        reveal_type(obj, expected_text="int")


T = TypeVar("T", bound=float)


def func4(t: type[T]):
    if issubclass(t, float):
        reveal_type(t, expected_text="type[float]*")
    else:
        reveal_type(t, expected_text="type[int]*")
