# This sample tests various type checking operations relating to
# generator functions (those with a "yield" method).

from typing import (
    Any,
    Awaitable,
    Generator,
    Generic,
    Iterable,
    Iterator,
    NamedTuple,
    Protocol,
    TypedDict,
    TypeVar,
)

T = TypeVar("T")


class ClassA:
    pass


s = True


class ClassB:
    def shouldContinue(self):
        global s
        return s


class ClassC:
    pass


class NT1(NamedTuple, Generic[T]):
    value: T


class ClassD(Generic[T]):
    def __init__(self, obj: T) -> None:
        self.obj = obj

    def ingest(self) -> Generator[NT1[T], None, None]:
        yield NT1(self.obj)


def generator1() -> Generator[ClassA, ClassB, ClassC]:
    cont = ClassB()
    while cont.shouldContinue():
        yield ClassA()

    return ClassC()


# This should generate an error because the function
# has no return statement at the bottom, so it
# returns None which is not assignable to ClassC.
def generator2() -> Generator[ClassA, ClassB, ClassC]:
    cont = ClassB()
    if cont.shouldContinue():
        # This should generate an error because False isn't
        # assignable to the return type (ClassC).
        return False

    while cont.shouldContinue():
        # This should generate an error because 3 isn't
        # assignable to the yield type (ClassA).
        yield 3


def generator3() -> Generator[ClassA, int, Any]:
    cont = ClassB()
    if cont.shouldContinue():
        return 3

    while cont.shouldContinue():
        # This should generate an error because 3 isn't
        # assignable to the yield type (ClassA).
        yield 3


def generator4() -> Iterable[ClassA]:
    yield ClassA()

    return True


def generator5() -> Iterator[ClassA]:
    # This should generate an error because ClassB isn't
    # assignable to ClassA.
    yield ClassB()


def generate():
    for i in range(2):
        yield i


s = generate()

# Verify that a call to a Generator method succeeds
s.close()


def generator6():
    yield


def generator7() -> Generator[None, None, None]:
    yield


def generator8() -> Iterator[dict[str, int]]:
    # This tests the bidirectional type inference
    # of dict types. It should not generate an error.
    yield {"hello": 3}


# This should generate an error.
def generator9() -> int:
    # This should generate an error.
    yield None
    return 3


# This should generate an error.
async def generator10() -> int:
    # This should generate an error.
    yield None


# This should generate an error.
def generator11() -> list[int]:
    # This should generate an error.
    yield 3


class TD1(TypedDict):
    x: str


def generator12() -> Generator[TD1, None, None]:
    yield {"x": "x"}


def generator13() -> Generator[TD1, None, None]:
    # This should generate an error.
    yield {"y": "x"}


def generator14() -> Iterator[TD1]:
    yield {"x": "x"}


class IntIterator(Protocol):
    def __next__(self, /) -> int: ...


def generator15() -> IntIterator:
    yield 0


class AsyncIntIterator(Protocol):
    def __anext__(self, /) -> Awaitable[int]: ...


async def generator16() -> AsyncIntIterator:
    yield 0
