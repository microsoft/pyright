# This sample tests the synthesized return type of `struct.unpack`,
# `struct.unpack_from` and `struct.iter_unpack` when the format string
# is a literal.

import struct
from typing import Any, Iterator, assert_type

buffer = b"\x00" * 64


# Basic numeric format codes with a repeat count.
assert_type(struct.unpack("<2i", buffer), tuple[int, int])

# A mix of element kinds.
assert_type(struct.unpack("<if?", buffer), tuple[int, float, bool])

# Repeat counts apply per code.
assert_type(struct.unpack("2i3f", buffer), tuple[int, int, float, float, float])

# A 's' code consumes its count as a single bytes value.
assert_type(struct.unpack("<3s", buffer), tuple[bytes])

# Pad bytes ('x') produce no elements.
assert_type(struct.unpack("<ix", buffer), tuple[int])

# 'c' produces one bytes value per repeat.
assert_type(struct.unpack("3c", buffer), tuple[bytes, bytes, bytes])

# A bytes literal format string works the same way.
assert_type(struct.unpack(b"<2i", buffer), tuple[int, int])

# An empty format string produces an empty tuple.
assert_type(struct.unpack("", buffer), tuple[()])

# unpack_from behaves the same as unpack.
assert_type(struct.unpack_from("<2i", buffer), tuple[int, int])
assert_type(struct.unpack_from("<2i", buffer, 4), tuple[int, int])

# iter_unpack returns an iterator of the synthesized tuple type.
assert_type(struct.iter_unpack("<2i", buffer), Iterator[tuple[int, int]])

# Whitespace between format codes is ignored.
assert_type(struct.unpack("i i", buffer), tuple[int, int])

# A format string consisting only of a byte-order character is an empty tuple.
assert_type(struct.unpack("@", buffer), tuple[()])


# An unrecognized format code falls back to the declared return type.
assert_type(struct.unpack("<2z", buffer), tuple[Any, ...])


# A non-literal format string falls back to the declared return type.
def func1(fmt: str) -> None:
    assert_type(struct.unpack(fmt, buffer), tuple[Any, ...])
