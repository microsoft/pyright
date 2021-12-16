# This sample checks that Type[None] is handled correctly.


from typing import Literal, Type


def func1(a: Type[None]) -> Type[str] | Type[None]:
    t1: Literal["Type[None]"] = reveal_type(a)

    # This should generate an error because None is
    # not compatible with Type[None].
    return None


val1 = func1(type(None))

if val1 is not None:
    t1: Literal["Type[str] | Type[None]"] = reveal_type(val1)

# This should generate an error because None isn't
# assignable to Type[None].
val2 = func1(None)
