from typing import Literal


def bytearray_multi(x: bytearray) -> Literal[b"a", b"b"]:
    return x  # error


def bytearray_union(x: bytearray) -> Literal[b"a"] | Literal[b"b"]:
    return x  # error


def bytearray_single(x: bytearray) -> Literal[b"a"]:
    return x  # error


def bytearray_mixed(x: bytearray) -> Literal[b"a", 0]:
    return x  # error


def memoryview_multi(x: memoryview) -> Literal[b"a", b"b"]:
    return x  # error


def memoryview_union(x: memoryview) -> Literal[b"a"] | Literal[b"b"]:
    return x  # error


def memoryview_single(x: memoryview) -> Literal[b"a"]:
    return x  # error


def memoryview_mixed(x: memoryview) -> Literal[b"a", 0]:
    return x  # error


def bytes_multi(x: bytes) -> Literal[b"a", b"b"]:
    return x  # error


def bytes_union(x: bytes) -> Literal[b"a"] | Literal[b"b"]:
    return x  # error


def bytes_single(x: bytes) -> Literal[b"a"]:
    return x  # error


def bytes_mixed(x: bytes) -> Literal[b"a", 0]:
    return x  # error


def valid(x: Literal[b"a", b"b"]) -> Literal[b"a"] | Literal[b"b"]:
    reveal_type(x, expected_text='Literal[b"a", b"b"]')
    return x


def literal_value() -> Literal[b"a", b"b"]:
    return b"a"


def ordinary_bytearray(x: bytearray) -> bytes:
    return x  # promotion


def ordinary_memoryview(x: memoryview) -> bytes:
    return x  # promotion
