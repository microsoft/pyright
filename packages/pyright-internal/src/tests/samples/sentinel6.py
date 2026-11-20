# This sample combines custom repr and runtime names without inventing singleton types.

import sys
from typing import Literal, assert_type
from typing_extensions import Sentinel as BackportSentinel, sentinel as backport_sentinel  # pyright: ignore[reportMissingModuleSource]

if sys.version_info >= (3, 15):
    from builtins import sentinel
else:
    from typing_extensions import sentinel  # pyright: ignore[reportMissingModuleSource]


MISSING = sentinel("MISSING", repr="<MISSING>")
OTHER = BackportSentinel("display name", repr=None)


def use_missing(value: int | MISSING) -> int:
    if value is MISSING:
        assert_type(value, MISSING)
        return 0
    assert_type(value, int)
    return value


def use_other(value: int | OTHER) -> int:
    if value is not OTHER:
        assert_type(value, int)
        return value
    assert_type(value, OTHER)
    return 0


def get_name() -> str:
    return "forward"


def forward(name: str, display: str | None) -> sentinel:
    return sentinel(name, repr=display)


def inferred_forward(name: str):
    return sentinel(name, repr="<forward>")


name = get_name()
plain = sentinel(name)
dynamic = sentinel(name, repr="<forward>")
called = sentinel(get_name(), repr=None)
formatted = backport_sentinel(f"forward {name}", repr=name)
computed = BackportSentinel("forward " + name, repr=name)
assert_type(plain, sentinel)
assert_type(dynamic, sentinel)
assert_type(called, sentinel)
assert_type(formatted, sentinel)
assert_type(computed, sentinel)
assert_type(forward(name, None), sentinel)
assert_type([dynamic, called, formatted, computed], list[sentinel])
reveal_type(inferred_forward, expected_text="(name: str) -> sentinel")


def literal_name(name: Literal["named"]) -> None:
    assert_type(sentinel(name, repr="<named>"), sentinel)


names: tuple[str] = (name,)
unpacked = sentinel(*names, repr="<forward>")
keyword_first = sentinel(repr="<forward>", *names)
none_first = sentinel(repr=None, *names)
backport_first = BackportSentinel(repr="<forward>", *names)
assert_type(unpacked, sentinel)
assert_type(keyword_first, sentinel)
assert_type(none_first, sentinel)
assert_type(backport_first, sentinel)


class Holder:
    runtime = sentinel(repr="<forward>", *names)
    MISSING = sentinel("MISSING", repr="<class missing>")


assert_type(Holder.runtime, sentinel)
assert_type(Holder.MISSING, Holder.MISSING)


def compare_runtime(value: int | sentinel) -> None:
    if value is keyword_first:
        assert_type(value, int | sentinel)
    else:
        assert_type(value, int | sentinel)
    if value is not keyword_first:
        assert_type(value, int | sentinel)
    else:
        assert_type(value, int | sentinel)
