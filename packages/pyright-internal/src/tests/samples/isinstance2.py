# This sample tests the case where a base class has
# an unknown type and the type is used in an
# isinstance check.

# pyright: reportUnnecessaryIsInstance=true

from typing import Union

# This should generate an error because "dummy" can't be resolved.
# The symbol Document should have an unknown type.
from dummy import Document


class DbModel(Document):
    pass


def foo() -> Union[int, DbModel]:
    return DbModel()


# This should not generate an error even though DbModel is
# derived from an unknown base class.
isinstance(foo(), int)


def bar(obj: object, typ: type):
    return isinstance(obj, typ)
