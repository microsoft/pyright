# This sample tests user-defined TypeIs and TypeGuard functions whose return type
# is a union of TypeIs or TypeGuard instances.

from typing import TypeGuard, TypeIs, assert_type, overload


def check_single(val: object) -> TypeIs[int] | TypeIs[str]:
    return isinstance(val, (int, str))


# This should generate an error because "int" is not a subtype of "str".
def invalid_typeis_union(val: str) -> TypeIs[int] | TypeIs[str]:  # pyright: ignore[reportGeneralTypeIssues]
    return False


@overload
def check_overload(val: object, target: type[int]) -> TypeIs[int]: ...
@overload
def check_overload(val: object, target: type[str]) -> TypeIs[str]: ...


def check_overload(val: object, target: type) -> bool:
    return isinstance(val, target)


def check_mixed(val: object) -> TypeIs[int] | TypeGuard[str]:
    return isinstance(val, (int, str))


def check_nonguard(val: object) -> TypeIs[int] | None:
    return isinstance(val, int) if val else None


def test_single(x: object):
    if check_single(x):
        assert_type(x, int | str)


def test_overload_positive(x: object, target: type[int] | type[str]):
    if check_overload(x, target):
        assert_type(x, int | str)


def test_overload_negative(x: int | str | bytes, target: type[int] | type[str]):
    if check_overload(x, target):
        assert_type(x, int | str)
    else:
        # A union of type guards is non-strict in the negative case to prevent
        # unsound type elimination when only one overload/arm applies at runtime.
        assert_type(x, int | str | bytes)


def test_mixed(x: object):
    if check_mixed(x):
        assert_type(x, int | str)


def test_nonguard(x: object):
    if check_nonguard(x):
        # Non-guard members in the return type union cause the type guard to be rejected.
        assert_type(x, object)
