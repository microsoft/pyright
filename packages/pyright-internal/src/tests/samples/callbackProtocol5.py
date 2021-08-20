# This sample tests the case where a callback protocol defines additional
# attributes.

from typing import Protocol


class SomeFunc(Protocol):
    __name__: str

    other_attribute: int

    def __call__(self) -> str:
        ...


def other_func(f: SomeFunc):
    print(f.__name__)

    f.other_attribute = 1

    # This should generate an error
    f.other_attribute = "str"

    # This should generate an error
    f.xxx = 3


@other_func
def some_func() -> str:
    ...
