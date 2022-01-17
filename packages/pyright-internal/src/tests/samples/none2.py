# This sample checks that Type[None] is handled correctly.


from typing import Type


def func1(a: Type[None]) -> Type[str] | Type[None]:
    reveal_type(a, expected_text="Type[None]")

    # This should generate an error because None is
    # not compatible with Type[None].
    return None


val1 = func1(type(None))

if val1 is not None:
    reveal_type(val1, expected_text="Type[str] | Type[None]")

# This should generate an error because None isn't
# assignable to Type[None].
val2 = func1(None)
