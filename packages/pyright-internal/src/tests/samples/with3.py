# This sample verifies the proper type analysis of context managers
# that suppress exceptions, as indicated by a return type of "bool"
# for the __exit__ or __aexit__ method.

from contextlib import suppress


def test() -> None:
    class A:
        b: str

    x = b""
    a = A()
    with memoryview(x), suppress(AttributeError):
        if a.b:
            raise RuntimeError()
        return

    # This should generate an error because
    # the code is not unreachable.
    c = "hi" + 3

    with memoryview(x):
        raise RuntimeError()

    # This should not generate an error because
    # the code is unreachable.
    return 3
