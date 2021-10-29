# This sample tests support for callback protocols (defined in PEP 544).

from typing import Optional, List, Protocol


class TestClass1(Protocol):
    def __call__(self, *vals: bytes, maxlen: Optional[int] = None) -> List[bytes]:
        return []


def good_cb(*vals: bytes, maxlen: Optional[int] = None) -> List[bytes]:
    return []


def bad_cb1(
    *vals: bytes, maxlen: Optional[int], maxitems: Optional[int]
) -> List[bytes]:
    return []


def bad_cb2(*vals: bytes) -> List[bytes]:
    return []


def bad_cb3(*vals: bytes, maxlen: Optional[str]) -> List[bytes]:
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


var2: TestClass2 = func1

# This should generate an error.
var2 = func2

# This should generate an error.
var2 = func3

# This should generate an error.
var2 = func4


class TestClass3(Protocol):
    def __call__(self) -> None:
        pass


var3: TestClass3 = func1

var3 = func2
var3 = func3
var3 = func4


class TestClass4(Protocol):
    foo: int

    def __call__(self, x: int) -> None:
        pass


def func5(x: int) -> None:
    pass


# This should generate an error.
var4: TestClass4 = func5


class TestClass5(Protocol):
    def __call__(self, *, a: int, b: str) -> int:
        ...


def func6(a: int, b: str) -> int:
    return 123


f: TestClass5 = func6


class TestClass6:
    def __call__(self, *vals: bytes, maxlen: Optional[int] = None) -> List[bytes]:
        return []


# This should generate an error because TestClass6 is not a protocol class.
var6: TestClass6 = good_cb
