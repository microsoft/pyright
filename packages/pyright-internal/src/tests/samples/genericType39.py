# This sample tests bidirectional type inference for a generic class
# constructor that is passed an argument expression that contains a
# binary operator.


def func1(x: list[str] | None):
    for _, v in enumerate(x or []):
        reveal_type(v, expected_text="str")
