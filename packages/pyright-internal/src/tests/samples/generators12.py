# This sample tests the inference of types relating to
# "yield from" statements.

from typing import Generator, Literal


class Yielder:
    def __iter__(self) -> Generator[int, None, bool]:
        yield 1
        return True


def collect1() -> Generator[str, None, bool]:
    y = Yielder()

    # This should generate an error because int doesn't match str.
    z = yield from y
    return z


def collect2():
    y = Yielder()
    z = yield from y
    t_z: Literal["bool"] = reveal_type(z)
    return z
