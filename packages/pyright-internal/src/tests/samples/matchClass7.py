# This sample tests the case where a class pattern overwrites the subject
# expression.

from dataclasses import dataclass


@dataclass
class DC1:
    val: str


def func1(val: DC1):
    result = val

    match result:
        case DC1(result):
            reveal_type(result, expected_text="str")


@dataclass
class DC2:
    val: DC1


def func2(val: DC2):
    result = val

    match result.val:
        case DC1(result):
            reveal_type(result, expected_text="str")

            # This should generate an error because result.val
            # is no longer valid at this point.
            print(result.val)
