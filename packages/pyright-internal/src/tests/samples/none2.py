# This sample checks that type[None] is handled correctly.


def func1(a: type[None]) -> type[str] | type[None]:
    reveal_type(a, expected_text="type[None]")

    # This should generate an error because None is
    # not compatible with Type[None].
    return None


val1 = func1(type(None))

if val1 is not None:
    reveal_type(val1, expected_text="type[str] | type[None]")

# This should generate an error because None isn't
# assignable to Type[None].
val2 = func1(None)

val3: type[object] = type(None)

val4 = type(None)()
reveal_type(val4, expected_text="None")
