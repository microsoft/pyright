# This sample tests the check for non-overlapping types compared
# with equals comparison.

from typing import Literal, TypeVar, Union


OS = Literal["Linux", "Darwin", "Windows"]


def func1(os: OS, val: Literal[1, "linux"]):
    if os == "Linux":
        return True

    # This should generate an error because there is no overlap in types.
    if os == "darwin":
        return False

    # This should generate an error because there is no overlap in types.
    if os != val:
        return False

    # This should generate an error because there is no overlap in types.
    if val == 2:
        return False

    if val == 1:
        return True


class ClassA:
    ...


class ClassB:
    ...


_T1 = TypeVar("_T1")
_T2 = TypeVar("_T2", bound=ClassB)


def func2(
    a: ClassA, b: ClassB, c: _T1, d: _T2, e: Union[ClassA, ClassB]
) -> Union[None, _T1, _T2]:
    # This should generate an error because there is no overlap in types.
    if a == b:
        return

    # This should generate an error because there is no overlap in types.
    if a != b:
        return

    if a != c:
        return

    # This should generate an error because there is no overlap in types.
    if a != d:
        return

    if a == e:
        return

    if b == e:
        return
