# This sample verifies that the Type[] and type[] annotations work
# as expected when the type argument is Any.

from typing import Literal, Type, Any


def is_type1(x: object, y: Type[Any]) -> bool:
    return isinstance(x, y)


is_type1(1, int)

# This should generate an error.
is_type1(1, 1)


def is_type2(x: object, y: type[Any]) -> bool:
    return isinstance(x, y)


is_type2(1, int)

# This should generate an error.
is_type2(1, 1)


def func1(v1: Type[Any], v2: type[Any]):
    t1: Literal["type"] = reveal_type(v1)
    t2: Literal["type"] = reveal_type(v2)
