# This sample tests that literal enums work.

from enum import Enum
from typing import Literal


class SomeEnum(Enum):
    SOME_ENUM_VALUE1 = "1"
    SOME_ENUM_VALUE2 = "2"
    SOME_ENUM_VALUE3 = "3"


class Foo:
    pass


# This should generate two errors because Foo() is not a valid
# type expression, and Foo is not an allowed literal value.
a: Literal["hi", Foo()]

# This should generate an error because SomeEnum is not an
# allowed literal value.
b: Literal["hi", SomeEnum]

L2 = Literal["hi", SomeEnum.SOME_ENUM_VALUE1]


def foo(a: int) -> L2:
    if a > 3:
        return "hi"
    elif a > 4:
        return SomeEnum.SOME_ENUM_VALUE1
    elif a > 5:
        # This should generate an error because it's
        # not part of the L1 literal.
        return SomeEnum.SOME_ENUM_VALUE2
    else:
        # This should generate an error because it's
        # not part of the L1 literal.
        return "bye"
