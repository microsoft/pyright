from typing import Literal, assert_type

Shared = Literal[
    "m00", "m01", "m02", "m03", "m04", "m05", "m06", "m07",
    "m08", "m09", "m10", "m11", "m12", "m13", "m14", "m15",
    "m16", "m17", "m18", "m19", "m20", "m21", "m22", "m23",
    "m24", "m25", "m26", "m27", "m28", "m29", "m30", "m31",
]
Early = Literal["a", Shared]
Late = Literal[Shared, "z"]
Invalid = Literal[Shared, "!"]


def accept_early(value: Early) -> int:
    return 0


def accept_late(value: Late) -> int:
    return 0


def check(value: Shared, invalid: Invalid, mixed: Literal[Shared, 0]) -> None:
    assert_type(accept_early(value), int)
    assert_type(accept_late(value), int)

    # These should generate errors.
    accept_early(invalid)
    accept_late(invalid)
    accept_early(mixed)


def append_extra(values: list[Early]) -> None:
    values.append("a")


def check_invariant(values: list[Shared]) -> None:
    # This should generate an error: append_extra can write outside Shared.
    append_extra(values)
