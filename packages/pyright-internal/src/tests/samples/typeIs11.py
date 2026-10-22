# This sample preserves legacy forward equality guards against type(other).

from builtins import type as runtime_type
from typing import Any, assert_type


def unknown_equality(value, sample: dict[str, int] | tuple[int, int]):
    if type(value) == type(sample):
        reveal_type(value, expected_text="dict[str, int] | tuple[int, int]")
        # This should generate two errors because neither alternative has this member.
        value.nonexistent()
    else:
        reveal_type(value, expected_text="Unknown")


def any_equality(value: Any, sample: dict[str, int] | tuple[int, int]):
    assert type(value) == type(sample)
    assert_type(value, dict[str, int] | tuple[int, int])
    # This should generate two errors because neither alternative has this member.
    value.nonexistent()


def unknown_inequality(value, sample: dict[str, int] | tuple[int, int]):
    if type(value) != type(sample):
        reveal_type(value, expected_text="Unknown")
    else:
        reveal_type(value, expected_text="dict[str, int] | tuple[int, int]")


def any_inequality(value: Any, sample: int):
    if type(value) != type(sample):
        assert_type(value, Any)
    else:
        assert_type(value, int)


def known_arguments(value: dict[str, int], sample: dict[str, Any]):
    if type(value) == type(sample):
        assert_type(value, dict[str, int])


def aliased_builtin(value: Any, sample: dict[str, int] | tuple[int, int]):
    if type(value) == runtime_type(sample):
        assert_type(value, dict[str, int] | tuple[int, int])


def shadowed_builtin(value: Any, sample: object):
    def type(_: object) -> runtime_type[int]:
        return int

    if runtime_type(value) == type(sample):
        assert_type(value, Any)


def dynamic_class(value: Any, expected: type[int]):
    if type(value) == expected:
        assert_type(value, Any)


def reverse_equality(value: Any, sample: int):
    if type(sample) == type(value):
        assert_type(value, Any)
    else:
        assert_type(value, Any)


class EqualMeta(type):
    def __eq__(cls, other: object) -> bool:
        return True


class Equal(metaclass=EqualMeta):
    pass


def custom_compared_metaclass(value: Any, sample: Equal):
    if type(value) == type(sample):
        assert_type(value, Any)
    else:
        assert_type(value, Any)

    if type(value) != type(sample):
        assert_type(value, Any)
    else:
        assert_type(value, Any)


def custom_reference_metaclass(value: Equal | str, sample: str):
    if type(value) == type(sample):
        assert_type(value, Equal | str)
    else:
        assert_type(value, Equal | str)
