# This sample tests various type checking operations relating to
# generator functions that use the "yield from" clause.

from typing import Generator, Iterator, TypeVar

T = TypeVar("T")


class ClassA:
    pass


class ClassB:
    def shouldContinue(self):
        return True


class ClassC:
    pass


def generator1() -> Iterator[ClassA]:
    yield from generator1()


def generator2() -> Iterator[ClassB]:
    # This should generate an error because it yields
    # an iterator of the wrong type.
    yield from generator1()

    # This should also generate an error because it
    # yields the wrong type.
    yield from [1]


def generator3(
    arg: Generator[int, None, T] | Generator[str, None, T],
) -> Generator[int | str, None, T]:
    x = yield from arg
    reveal_type(x, expected_text="T@generator3")
    return x


def generator4(
    arg: Generator[int, None, int] | Generator[str, None, str],
) -> Generator[int | str, None, int | str]:
    x = yield from arg
    reveal_type(x, expected_text="int | str")
    return x


def generator5() -> Generator[None, float, None]:
    x: float = yield


def generator6() -> Generator[None, int, None]:
    yield from generator5()


def generator7() -> Generator[None, int, None]:
    x: float = yield


def generator8() -> Generator[None, float, None]:
    # This should generate an error because of the send type.
    yield from generator7()
