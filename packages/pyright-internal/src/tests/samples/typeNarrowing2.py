# This sample tests the type narrowing logic for "continue"
# statements within a loop.


def func1(args: list[int | None]):
    for arg in args:
        if arg is None:
            continue

        reveal_type(arg.bit_length(), expected_text="int")
