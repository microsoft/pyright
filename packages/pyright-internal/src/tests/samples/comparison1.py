# This sample tests the check for non-overlapping types compared
# with equals comparison.

from typing import Literal


OS = Literal["Linux", "Darwin", "Windows"]


def func1(os: OS, val: Literal[1, "linux"]):
    if os == "Linux":
        return True

    # This should generate an error because there is no overlap in types.
    if os == "darwin":
        return False

    # This should generate an error because there is no overlap in types.
    if os == val:
        return False

    # This should generate an error because there is no overlap in types.
    if val == 2:
        return False

    if val == 1:
        return True
