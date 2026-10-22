# Tuple dispatch refusal, singleton equality, and numeric prefix regressions.
from __future__ import annotations
from typing import assert_type
from types import NotImplementedType, EllipsisType


def case_partial_builtin_fallback_lt():
    class A:
        def __lt__(self, other: object) -> bool | NotImplementedType: return True
    assert_type((A(),) < (1,), bool)
    assert ((A(),) < (1,)) is True


def case_singleton_NotImplementedType_lt():
    def compare(a: NotImplementedType, b: NotImplementedType) -> bool:
        assert_type((a, 0) < (b, 1), bool)
        return (a, 0) < (b, 1)
    assert isinstance(compare(NotImplemented, NotImplemented), bool)


def case_singleton_EllipsisType_lt():
    def compare(a: EllipsisType, b: EllipsisType) -> bool:
        assert_type((a, 0) < (b, 1), bool)
        return (a, 0) < (b, 1)
    assert isinstance(compare(..., ...), bool)


def case_complex_prefix_lt():
    assert_type((1j, "a") < (1j, "b"), bool)
    assert_type((0j, "a") < (0, "b"), bool)
    assert_type((-1j, "a") < (-1j, "b"), bool)
    assert_type((0j, "a") < (False, "b"), bool)


def case_complex_unequal_lt():
    bad = (1j, "text") < (2j, 3) # ERROR reportOperatorIssue


def case_numeric_unequal_lt():
    assert_type((1.0, "text") < (2, 3), bool)
    assert_type((9007199254740993, "text") < (9007199254740992.0, 3), bool)
    left = (-1.0, "text")
    alias = left
    left = (2.0, "other")
    assert_type(alias < (0, 3), bool)


def case_numeric_equal_bad_lt():
    bad = (1.0, "text") < (1, 3) # ERROR reportOperatorIssue
    bad_large = (9007199254740992, "text") < (9007199254740992.0, 3) # ERROR reportOperatorIssue


def case_none_result_lt():
    class A:
        def __lt__(self, other: object) -> None: return None
    def compare(a: A, b: A) -> None | bool:
        assert_type((a,) < (b,), None | bool)
        return (a,) < (b,)
    assert compare(A(), A()) is None


def case_partial_refusal_mixed_lt():
    class A:
        def __lt__(self, other: object) -> bool | NotImplementedType: return True
        def __gt__(self, other: object) -> bool | NotImplementedType: return True

    def compare(a: A, b: A) -> bool:
        result = (a,) < (b,)
        assert_type(result, bool)
        return result
    assert compare(A(), A()) is True


def case_partial_refusal_missing_lt():
    class A:
        def __lt__(self, other: object) -> bool | NotImplementedType: return True

    def compare(a: A, b: A) -> bool:
        result = (a,) < (b,)
        assert_type(result, bool)
        return result
    assert compare(A(), A()) is True


def case_partial_refusal_declines_lt():
    class A:
        def __lt__(self, other: object) -> bool | NotImplementedType: return True
        def __gt__(self, other: object) -> NotImplementedType: return NotImplemented

    def compare(a: A, b: A) -> bool:
        result = (a,) < (b,)
        assert_type(result, bool)
        return result
    assert compare(A(), A()) is True


def case_partial_nonbool_lt():
    class A:
        def __lt__(self, other: object) -> str | NotImplementedType: return "text"
        def __gt__(self, other: object) -> int | NotImplementedType: return 1
    def compare(a: A, b: A) -> str | int | bool:
        result = (a,) < (b,)
        assert_type(result, str | int | bool)
        return result
    assert compare(A(), A()) == "text"


def case_partial_nonbool_consumer_lt():
    class A:
        def __lt__(self, other: object) -> str | NotImplementedType: return "text"
        def __gt__(self, other: object) -> int | NotImplementedType: return 1
    def compare(a: A, b: A) -> bool:
        return (a,) < (b,) # ERROR reportReturnType


def case_partial_builtin_fallback_le():
    class A:
        def __le__(self, other: object) -> bool | NotImplementedType: return True
    assert_type((A(),) <= (1,), bool)
    assert ((A(),) <= (1,)) is True


def case_singleton_NotImplementedType_le():
    def compare(a: NotImplementedType, b: NotImplementedType) -> bool:
        assert_type((a, 0) <= (b, 1), bool)
        return (a, 0) <= (b, 1)
    assert isinstance(compare(NotImplemented, NotImplemented), bool)


def case_singleton_EllipsisType_le():
    def compare(a: EllipsisType, b: EllipsisType) -> bool:
        assert_type((a, 0) <= (b, 1), bool)
        return (a, 0) <= (b, 1)
    assert isinstance(compare(..., ...), bool)


def case_complex_prefix_le():
    assert_type((1j, "a") <= (1j, "b"), bool)
    assert_type((0j, "a") <= (0, "b"), bool)
    assert_type((-1j, "a") <= (-1j, "b"), bool)
    assert_type((0j, "a") <= (False, "b"), bool)


def case_complex_unequal_le():
    bad = (1j, "text") <= (2j, 3) # ERROR reportOperatorIssue


def case_numeric_unequal_le():
    assert_type((1.0, "text") <= (2, 3), bool)
    assert_type((9007199254740993, "text") <= (9007199254740992.0, 3), bool)
    left = (-1.0, "text")
    alias = left
    left = (2.0, "other")
    assert_type(alias <= (0, 3), bool)


def case_numeric_equal_bad_le():
    bad = (1.0, "text") <= (1, 3) # ERROR reportOperatorIssue
    bad_large = (9007199254740992, "text") <= (9007199254740992.0, 3) # ERROR reportOperatorIssue


def case_none_result_le():
    class A:
        def __le__(self, other: object) -> None: return None
    def compare(a: A, b: A) -> None | bool:
        assert_type((a,) <= (b,), None | bool)
        return (a,) <= (b,)
    assert compare(A(), A()) is None


def case_partial_refusal_mixed_le():
    class A:
        def __le__(self, other: object) -> bool | NotImplementedType: return True
        def __ge__(self, other: object) -> bool | NotImplementedType: return True

    def compare(a: A, b: A) -> bool:
        result = (a,) <= (b,)
        assert_type(result, bool)
        return result
    assert compare(A(), A()) is True


def case_partial_refusal_missing_le():
    class A:
        def __le__(self, other: object) -> bool | NotImplementedType: return True

    def compare(a: A, b: A) -> bool:
        result = (a,) <= (b,)
        assert_type(result, bool)
        return result
    assert compare(A(), A()) is True


def case_partial_refusal_declines_le():
    class A:
        def __le__(self, other: object) -> bool | NotImplementedType: return True
        def __ge__(self, other: object) -> NotImplementedType: return NotImplemented

    def compare(a: A, b: A) -> bool:
        result = (a,) <= (b,)
        assert_type(result, bool)
        return result
    assert compare(A(), A()) is True


def case_partial_nonbool_le():
    class A:
        def __le__(self, other: object) -> str | NotImplementedType: return "text"
        def __ge__(self, other: object) -> int | NotImplementedType: return 1
    def compare(a: A, b: A) -> str | int | bool:
        result = (a,) <= (b,)
        assert_type(result, str | int | bool)
        return result
    assert compare(A(), A()) == "text"


def case_partial_nonbool_consumer_le():
    class A:
        def __le__(self, other: object) -> str | NotImplementedType: return "text"
        def __ge__(self, other: object) -> int | NotImplementedType: return 1
    def compare(a: A, b: A) -> bool:
        return (a,) <= (b,) # ERROR reportReturnType


def case_partial_builtin_fallback_gt():
    class A:
        def __gt__(self, other: object) -> bool | NotImplementedType: return True
    assert_type((A(),) > (1,), bool)
    assert ((A(),) > (1,)) is True


def case_singleton_NotImplementedType_gt():
    def compare(a: NotImplementedType, b: NotImplementedType) -> bool:
        assert_type((a, 0) > (b, 1), bool)
        return (a, 0) > (b, 1)
    assert isinstance(compare(NotImplemented, NotImplemented), bool)


def case_singleton_EllipsisType_gt():
    def compare(a: EllipsisType, b: EllipsisType) -> bool:
        assert_type((a, 0) > (b, 1), bool)
        return (a, 0) > (b, 1)
    assert isinstance(compare(..., ...), bool)


def case_complex_prefix_gt():
    assert_type((1j, "a") > (1j, "b"), bool)
    assert_type((0j, "a") > (0, "b"), bool)
    assert_type((-1j, "a") > (-1j, "b"), bool)
    assert_type((0j, "a") > (False, "b"), bool)


def case_complex_unequal_gt():
    bad = (1j, "text") > (2j, 3) # ERROR reportOperatorIssue


def case_numeric_unequal_gt():
    assert_type((1.0, "text") > (2, 3), bool)
    assert_type((9007199254740993, "text") > (9007199254740992.0, 3), bool)
    left = (-1.0, "text")
    alias = left
    left = (2.0, "other")
    assert_type(alias > (0, 3), bool)


def case_numeric_equal_bad_gt():
    bad = (1.0, "text") > (1, 3) # ERROR reportOperatorIssue
    bad_large = (9007199254740992, "text") > (9007199254740992.0, 3) # ERROR reportOperatorIssue


def case_none_result_gt():
    class A:
        def __gt__(self, other: object) -> None: return None
    def compare(a: A, b: A) -> None | bool:
        assert_type((a,) > (b,), None | bool)
        return (a,) > (b,)
    assert compare(A(), A()) is None


def case_partial_refusal_mixed_gt():
    class A:
        def __gt__(self, other: object) -> bool | NotImplementedType: return True
        def __lt__(self, other: object) -> bool | NotImplementedType: return True

    def compare(a: A, b: A) -> bool:
        result = (a,) > (b,)
        assert_type(result, bool)
        return result
    assert compare(A(), A()) is True


def case_partial_refusal_missing_gt():
    class A:
        def __gt__(self, other: object) -> bool | NotImplementedType: return True

    def compare(a: A, b: A) -> bool:
        result = (a,) > (b,)
        assert_type(result, bool)
        return result
    assert compare(A(), A()) is True


def case_partial_refusal_declines_gt():
    class A:
        def __gt__(self, other: object) -> bool | NotImplementedType: return True
        def __lt__(self, other: object) -> NotImplementedType: return NotImplemented

    def compare(a: A, b: A) -> bool:
        result = (a,) > (b,)
        assert_type(result, bool)
        return result
    assert compare(A(), A()) is True


def case_partial_nonbool_gt():
    class A:
        def __gt__(self, other: object) -> str | NotImplementedType: return "text"
        def __lt__(self, other: object) -> int | NotImplementedType: return 1
    def compare(a: A, b: A) -> str | int | bool:
        result = (a,) > (b,)
        assert_type(result, str | int | bool)
        return result
    assert compare(A(), A()) == "text"


def case_partial_nonbool_consumer_gt():
    class A:
        def __gt__(self, other: object) -> str | NotImplementedType: return "text"
        def __lt__(self, other: object) -> int | NotImplementedType: return 1
    def compare(a: A, b: A) -> bool:
        return (a,) > (b,) # ERROR reportReturnType


def case_partial_builtin_fallback_ge():
    class A:
        def __ge__(self, other: object) -> bool | NotImplementedType: return True
    assert_type((A(),) >= (1,), bool)
    assert ((A(),) >= (1,)) is True


def case_singleton_NotImplementedType_ge():
    def compare(a: NotImplementedType, b: NotImplementedType) -> bool:
        assert_type((a, 0) >= (b, 1), bool)
        return (a, 0) >= (b, 1)
    assert isinstance(compare(NotImplemented, NotImplemented), bool)


def case_singleton_EllipsisType_ge():
    def compare(a: EllipsisType, b: EllipsisType) -> bool:
        assert_type((a, 0) >= (b, 1), bool)
        return (a, 0) >= (b, 1)
    assert isinstance(compare(..., ...), bool)


def case_complex_prefix_ge():
    assert_type((1j, "a") >= (1j, "b"), bool)
    assert_type((0j, "a") >= (0, "b"), bool)
    assert_type((-1j, "a") >= (-1j, "b"), bool)
    assert_type((0j, "a") >= (False, "b"), bool)


def case_complex_unequal_ge():
    bad = (1j, "text") >= (2j, 3) # ERROR reportOperatorIssue


def case_numeric_unequal_ge():
    assert_type((1.0, "text") >= (2, 3), bool)
    assert_type((9007199254740993, "text") >= (9007199254740992.0, 3), bool)
    left = (-1.0, "text")
    alias = left
    left = (2.0, "other")
    assert_type(alias >= (0, 3), bool)


def case_numeric_equal_bad_ge():
    bad = (1.0, "text") >= (1, 3) # ERROR reportOperatorIssue
    bad_large = (9007199254740992, "text") >= (9007199254740992.0, 3) # ERROR reportOperatorIssue


def case_none_result_ge():
    class A:
        def __ge__(self, other: object) -> None: return None
    def compare(a: A, b: A) -> None | bool:
        assert_type((a,) >= (b,), None | bool)
        return (a,) >= (b,)
    assert compare(A(), A()) is None


def case_partial_refusal_mixed_ge():
    class A:
        def __ge__(self, other: object) -> bool | NotImplementedType: return True
        def __le__(self, other: object) -> bool | NotImplementedType: return True

    def compare(a: A, b: A) -> bool:
        result = (a,) >= (b,)
        assert_type(result, bool)
        return result
    assert compare(A(), A()) is True


def case_partial_refusal_missing_ge():
    class A:
        def __ge__(self, other: object) -> bool | NotImplementedType: return True

    def compare(a: A, b: A) -> bool:
        result = (a,) >= (b,)
        assert_type(result, bool)
        return result
    assert compare(A(), A()) is True


def case_partial_refusal_declines_ge():
    class A:
        def __ge__(self, other: object) -> bool | NotImplementedType: return True
        def __le__(self, other: object) -> NotImplementedType: return NotImplemented

    def compare(a: A, b: A) -> bool:
        result = (a,) >= (b,)
        assert_type(result, bool)
        return result
    assert compare(A(), A()) is True


def case_partial_nonbool_ge():
    class A:
        def __ge__(self, other: object) -> str | NotImplementedType: return "text"
        def __le__(self, other: object) -> int | NotImplementedType: return 1
    def compare(a: A, b: A) -> str | int | bool:
        result = (a,) >= (b,)
        assert_type(result, str | int | bool)
        return result
    assert compare(A(), A()) == "text"


def case_partial_nonbool_consumer_ge():
    class A:
        def __ge__(self, other: object) -> str | NotImplementedType: return "text"
        def __le__(self, other: object) -> int | NotImplementedType: return 1
    def compare(a: A, b: A) -> bool:
        return (a,) >= (b,) # ERROR reportReturnType
