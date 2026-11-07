# This sample tests runtime sentinel creation without a statically declared singleton.

import sys
from typing import Literal, TypeAlias, assert_never, assert_type
from typing_extensions import Sentinel as BackportSentinel, sentinel as backport_sentinel  # pyright: ignore[reportMissingModuleSource]

if sys.version_info >= (3, 15):
    from builtins import sentinel
else:
    from typing_extensions import sentinel  # pyright: ignore[reportMissingModuleSource]


def get_name() -> str:
    return "forward"


def forward(name: str) -> sentinel:
    return sentinel(name)


def inferred_forward(name: str):
    return sentinel(name)


name = "forward"
dynamic = sentinel(name)
called = sentinel(get_name())
formatted = sentinel(f"forward {name}")
computed = sentinel("forward " + name)
empty = sentinel("")
returned = forward(name)
assert_type(dynamic, sentinel)
assert_type(called, sentinel)
assert_type(formatted, sentinel)
assert_type(computed, sentinel)
assert_type(empty, sentinel)
assert_type(returned, sentinel)
assert_type(BackportSentinel(name), sentinel)
assert_type(backport_sentinel(name), sentinel)
reveal_type(inferred_forward, expected_text="(name: str) -> sentinel")
assert_type([dynamic, called], list[sentinel])
assert_type(sentinel("forward " f"{name}"), sentinel)


class Holder:
    value = sentinel(get_name())


assert_type(Holder.value, sentinel)

# These should generate errors because runtime instances are not type expressions.
bad_annotation: dynamic
bad_returned_annotation: returned
bad_alias: TypeAlias = called
type BadAlias = computed


def literal_name(name: Literal["named"]) -> None:
    # A variable with a literal type is still not a static singleton declaration.
    assert_type(sentinel(name), sentinel)


def repeat(name: str) -> None:
    first, second = inferred_forward(name), inferred_forward(name)
    if first is second:
        assert_type(first, sentinel)
    else:
        assert_type(first, sentinel)
        # This should generate an error because repeated allocations can differ.
        assert_never(first)
    if first is not second:
        assert_type(first, sentinel)
    else:
        assert_type(first, sentinel)


MISSING = sentinel("MISSING")


def compare_dynamic(value: int | sentinel, other: sentinel) -> None:
    if value is other:
        assert_type(value, int | sentinel)
    else:
        assert_type(value, int | sentinel)
    if value is not other:
        assert_type(value, int | sentinel)
    else:
        assert_type(value, int | sentinel)


def compare_singleton(value: int | sentinel | MISSING) -> None:
    if value is MISSING:
        assert_type(value, MISSING)
    else:
        assert_type(value, int | sentinel)
    if value is not MISSING:
        assert_type(value, int | sentinel)
    else:
        assert_type(value, MISSING)


def preserve_singleton(value: int | MISSING) -> None:
    if value is MISSING:
        assert_type(value, MISSING)
    else:
        assert_type(value, int)
    if value is not MISSING:
        assert_type(value, int)
    else:
        assert_type(value, MISSING)
