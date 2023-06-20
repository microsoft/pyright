# This sample tests the case where an isinstance type guard is used
# with a dynamic set of types.

SOME_TYPES_L: list[type[object]] = [int, float]
SOME_TYPES: tuple[type[object], ...] = tuple(SOME_TYPES_L)


def check_object(obj: object):
    if isinstance(obj, SOME_TYPES):
        reveal_type(obj, expected_text="object")
        return
    reveal_type(obj, expected_text="object")

    if isinstance(obj, list):
        reveal_type(obj, expected_text="list[Unknown]")
