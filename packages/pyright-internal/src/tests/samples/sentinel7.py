# Runtime name validation should agree with an ordinary positional-only str parameter.

import sys
from typing import Any, assert_type

if sys.version_info >= (3, 15):
    from builtins import sentinel
else:
    from typing_extensions import sentinel  # pyright: ignore[reportMissingModuleSource]


def ordinary(name: str, /) -> sentinel:
    return sentinel(name)


def valid(name: str, any_name: Any, unknown_name, names: tuple[str], many: tuple[str, ...]) -> None:
    assert_type(sentinel(name), sentinel)
    assert_type(sentinel(any_name), sentinel)
    assert_type(sentinel(unknown_name), sentinel)
    assert_type(sentinel(*names), sentinel)
    assert_type(sentinel(*many), sentinel)
    assert_type(ordinary(name), sentinel)
    assert_type(ordinary(any_name), sentinel)
    assert_type(ordinary(unknown_name), sentinel)
    assert_type(ordinary(*names), sentinel)
    assert_type(ordinary(*many), sentinel)


def invalid(number: int, optional: str | None, mixed: str | int, mixed_any: Any | int) -> None:
    # Each call below should generate an argument type error.
    sentinel(number)
    ordinary(number)
    sentinel(None)
    ordinary(None)
    sentinel(["name"])
    ordinary(["name"])
    sentinel(optional)
    ordinary(optional)
    sentinel(mixed)
    ordinary(mixed)
    sentinel(mixed_any)
    ordinary(mixed_any)


def mixed_unknown(unknown_name, flag: bool) -> None:
    name = unknown_name if flag else 1
    # Each call should reject the known non-string part of the union.
    sentinel(name)
    ordinary(name)


def unpack(names: tuple[int], too_many: tuple[str, str], keywords: dict[str, str], name: str) -> None:
    # Each pair should generate the same argument or call diagnostics.
    sentinel(*names)
    ordinary(*names)
    sentinel(*too_many)
    ordinary(*too_many)
    sentinel(**keywords)
    ordinary(**keywords)
    sentinel(name=name)
    ordinary(name=name)


def count_and_repr(name: str) -> None:
    # Preserve the existing one-argument restriction; repr support is separate.
    sentinel()
    sentinel(name, name)
    sentinel(name, repr=name)
