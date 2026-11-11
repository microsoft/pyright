# Tuple equality can expose a fresh list to a compatible subclass before ordering.
from typing import assert_type, cast


class ReturnsText:
    def __lt__(self, other: object) -> str:
        return "lt"

    def __le__(self, other: object) -> str:
        return "le"

    def __gt__(self, other: object) -> str:
        return "gt"

    def __ge__(self, other: object) -> str:
        return "ge"


class EqualityMutator(list[ReturnsText]):
    def __eq__(self, other: object) -> bool:
        if isinstance(other, list):
            cast(list[ReturnsText], other).append(ReturnsText())
        return False


def callback_left(other: list[ReturnsText]) -> None:
    lt = ([],) < (other,)
    le = ([],) <= (other,)
    gt = ([],) > (other,)
    ge = ([],) >= (other,)
    reveal_type(lt, expected_text="Unknown | bool")
    reveal_type(le, expected_text="Unknown | bool")
    reveal_type(gt, expected_text="Unknown | bool")
    reveal_type(ge, expected_text="Unknown | bool")
    assert_type(lt, bool)  # This should generate an assert-type error.
    assert_type(le, bool)  # This should generate an assert-type error.
    assert_type(gt, bool)  # This should generate an assert-type error.
    assert_type(ge, bool)  # This should generate an assert-type error.


def callback_right(other: list[ReturnsText]) -> None:
    lt = (other,) < ([],)
    le = (other,) <= ([],)
    gt = (other,) > ([],)
    ge = (other,) >= ([],)
    reveal_type(lt, expected_text="Unknown | bool")
    reveal_type(le, expected_text="Unknown | bool")
    reveal_type(gt, expected_text="Unknown | bool")
    reveal_type(ge, expected_text="Unknown | bool")
    assert_type(lt, bool)  # This should generate an assert-type error.
    assert_type(le, bool)  # This should generate an assert-type error.
    assert_type(gt, bool)  # This should generate an assert-type error.
    assert_type(ge, bool)  # This should generate an assert-type error.


def exact_list_literals() -> None:
    assert_type(([],) < ([],), bool)
    assert_type(([],) <= ([],), bool)
    assert_type(([],) > ([],), bool)
    assert_type(([],) >= ([],), bool)
    assert_type(([],) < ([ReturnsText()],), bool)
    assert_type(([],) <= ([ReturnsText()],), bool)
    assert_type(([],) > ([ReturnsText()],), bool)
    assert_type(([],) >= ([ReturnsText()],), bool)
    assert_type(([ReturnsText()],) < ([],), bool)
    assert_type(([ReturnsText()],) <= ([],), bool)
    assert_type(([ReturnsText()],) > ([],), bool)
    assert_type(([ReturnsText()],) >= ([],), bool)


def typed_lists(left: list[ReturnsText], right: list[ReturnsText]) -> None:
    assert_type((left,) < (right,), str | bool)
    assert_type((left,) <= (right,), str | bool)
    assert_type((left,) > (right,), str | bool)
    assert_type((left,) >= (right,), str | bool)


def valid_unknown_consumer(other: list[ReturnsText]) -> object:
    return ([],) < (other,)


def invalid_typed_consumer(left: list[ReturnsText], right: list[ReturnsText]) -> bool:
    return (left,) < (right,)  # This should generate a return-type error.


def exact_list_prefixes(value: ReturnsText) -> None:
    assert_type(([], value) < ([ReturnsText()], 0), bool)
    assert_type(([], value) <= ([ReturnsText()], 0), bool)
    assert_type(([], value) > ([ReturnsText()], 0), bool)
    assert_type(([], value) >= ([ReturnsText()], 0), bool)
    assert_type(([ReturnsText()], value) < ([], 0), bool)
    assert_type(([ReturnsText()], value) <= ([], 0), bool)
    assert_type(([ReturnsText()], value) > ([], 0), bool)
    assert_type(([ReturnsText()], value) >= ([], 0), bool)
    assert_type(([], value) < ([], 0), str | bool)
    assert_type(([], value) <= ([], 0), str | bool)
    assert_type(([], value) > ([], 0), str | bool)
    assert_type(([], value) >= ([], 0), str | bool)


def uncertain_list_prefixes(value: ReturnsText, items: list[ReturnsText]) -> None:
    assert_type(([], value) < ([*items], 0), str | bool)
    assert_type(([], value) <= ([*items], 0), str | bool)
    assert_type(([], value) > ([*items], 0), str | bool)
    assert_type(([], value) >= ([*items], 0), str | bool)
    assert_type(([*items], value) < ([], 0), str | bool)
    assert_type(([*items], value) <= ([], 0), str | bool)
    assert_type(([*items], value) > ([], 0), str | bool)
    assert_type(([*items], value) >= ([], 0), str | bool)
    assert_type(([], value) < ([item for item in items], 0), str | bool)
    assert_type(([], value) <= ([item for item in items], 0), str | bool)
    assert_type(([], value) > ([item for item in items], 0), str | bool)
    assert_type(([], value) >= ([item for item in items], 0), str | bool)
    assert_type(([item for item in items], value) < ([], 0), str | bool)
    assert_type(([item for item in items], value) <= ([], 0), str | bool)
    assert_type(([item for item in items], value) > ([], 0), str | bool)
    assert_type(([item for item in items], value) >= ([], 0), str | bool)
