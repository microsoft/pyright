# This sample tests that a Sentinel with a non-CONSTANT_NAME binding
# retains its literal type when accessed as a module attribute.

from . import sentinel3


def func1(value: object) -> None:
    reveal_type(sentinel3.Empty, expected_text="Empty")

    if value is sentinel3.Empty:
        reveal_type(value, expected_text="Empty")
