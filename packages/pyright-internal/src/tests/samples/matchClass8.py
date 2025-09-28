# This sample tests the case where a NewType is used as a class pattern.

from typing import NewType


NT1 = NewType("NT1", int)


def accepts_widget_id(value: NT1 | int) -> None:
    match value:
        case NT1():
            # This should generate an error because NewType returns a function at runtime.
            pass


NT2 = NewType("NT2", str)


def accepts_union(value: NT1 | NT2) -> None:
    match value:
        case NT1():
            # This should generate an error because NewType returns a function at runtime.
            pass

        case NT2():
            # This should generate an error because NewType returns a function at runtime.
            pass
