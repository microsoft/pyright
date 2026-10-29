# Mapping an iterable alias must not attach it to the shared union yielded by it.
# Repeated inference previously created cycles in the alias sources (#11067).

from collections.abc import Iterator


class A[T]:
    def __iter__(self) -> Iterator[T]: ...


class B[T]:
    def __iter__(self) -> Iterator[T]: ...


type C[T] = A[T] | B[T]


def source() -> C[int | str]: ...



def generator_0():
    yield from source()


def generator_1():
    yield from source()


def generator_2():
    yield from source()


def generator_3():
    yield from source()


def generator_4():
    yield from source()


def generator_5():
    yield from source()


def generator_6():
    yield from source()


def generator_7():
    yield from source()


def generator_8():
    yield from source()


def generator_9():
    yield from source()


reveal_type(generator_0(), expected_text="Generator[int | str, Unknown, None]")
reveal_type(generator_9(), expected_text="Generator[int | str, Unknown, None]")
