# This sample tests support for callback protocols (defined in PEP 544).

from typing import Callable, Protocol


class TestClass1(Protocol):
    def __call__(self, *vals: bytes, maxlen: int | None = None) -> list[bytes]:
        return []


def good_cb(*vals: bytes, maxlen: int | None = None) -> list[bytes]:
    return []


def bad_cb1(*vals: bytes, maxlen: int | None, maxitems: int | None) -> list[bytes]:
    return []


def bad_cb2(*vals: bytes) -> list[bytes]:
    return []


def bad_cb3(*vals: bytes, maxlen: str | None) -> list[bytes]:
    return []


var1: TestClass1 = good_cb

# This should generate an error because maxitems is unmatched.
var1 = bad_cb1

# This should generate an error because maxlen is unmatched.
var1 = bad_cb2

# This should generate an error because maxlen is the wrong type.
var1 = bad_cb3


class TestClass2(Protocol):
    def __call__(self, *vals: bytes, **kwargs: str) -> None:
        pass


def func1(*a: bytes, **b: str):
    pass


def func2(*a: bytes):
    pass


def func3(*a: str, **b: str):
    pass


def func4(*a: bytes, **b: bytes):
    pass


def func5(**b: str):
    pass


var2: TestClass2 = func1

# This should generate an error.
var2 = func2

# This should generate an error.
var2 = func3

# This should generate an error.
var2 = func4

# This should generate an error.
var2 = func5


class NotProto:
    def __call__(self, *vals: bytes, maxlen: int | None = None) -> list[bytes]:
        return []


# This should generate an error because NotProto is not a protocol class.
not_proto: NotProto = good_cb


class TestClass3(Protocol):
    def __call__(self) -> None:
        pass


var3: TestClass3 = func1

var3 = func2
var3 = func3
var3 = func4
var3 = func5


class TestClass4(Protocol):
    foo: int

    def __call__(self, x: int) -> None:
        pass


def test_func4(x: int) -> None:
    pass


# This should generate an error.
var4: TestClass4 = test_func4


class TestClass5(Protocol):
    def __call__(self, *, a: int, b: str) -> int: ...


def test_func5(a: int, b: str) -> int:
    return 123


f5: TestClass5 = test_func5


class TestClass6(Protocol):
    def __call__(self, a: int, /, *, b: str) -> int: ...


def test_func6(a: int, b: str) -> int:
    return 123


f6: TestClass6 = test_func6


class TestClass7:
    def __call__(self) -> None:
        pass


def test_func7(*args: *tuple[int, *tuple[int, ...]]) -> int:
    return 123


# This should generate an error.
f7: TestClass7 = test_func7


class TestClass8:
    def __call__(self: Callable[[int], int], v: int) -> int:
        return v


def func8(f: Callable[[int], int]): ...


func8(TestClass8())
