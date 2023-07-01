# This sample tests the type checker's validation of class variables
# whose name conflict with a __slots__ entry.

from dataclasses import dataclass, field


class NoSlots1:
    pass


class Slots1(NoSlots1):
    __slots__ = "aaa", "bbb", "ccc"

    # This should generate an error
    aaa = 3

    # This should generate an error
    bbb: int = 3

    # This should generate an error
    (ccc, ddd) = 3, 4

    eee = 5


class Slots2(Slots1):
    __slots__ = ()

    aaa = 4


@dataclass
class Slots3:
    __slots__ = ("values",)

    # This should not generate an error because class variables
    # in a dataclass are replaced by instance variables.
    values: list[int] = field(default_factory=list)
