# This sample validates the Python 3.7 data class feature.

from typing import ClassVar, Final, Hashable, NamedTuple


class Other:
    pass


def standalone(obj: object) -> None:
    print(obj)


class DataTuple(NamedTuple):
    def _m(self):
        pass

    id: int
    aid: Other
    value: str = ""

    # Unannotated variables should not be included.
    not_annotated = 5

    name: str | None = None
    name2: str | None = None

    not_a_method = standalone


d1 = DataTuple(id=1, aid=Other(), name2="hi")
d1.not_a_method()

d2 = DataTuple(id=1, aid=Other(), value="v")
d3 = DataTuple(id=1, aid=Other(), name="hello")
d4 = DataTuple(id=1, aid=Other(), name=None)
id = d1.id

h4: Hashable = d4
v = d3 == d4

# This should generate an error because the name argument
# is the incorrect type.
d5 = DataTuple(id=1, aid=Other(), name=3)

# This should generate an error because aid is a required
# parameter and is missing an argument here.
d6 = DataTuple(id=1, name=None)


class DataTuple2(NamedTuple):
    # This should generate an error because Final cannot
    # be used in a NamedTuple. A second downstream error
    # is also generated.
    x: Final[int]

    # This should generate an error because Final cannot
    # be used in a NamedTuple.
    y: Final = 1

    # This should generate an error because ClassVar cannot
    # be used in a NamedTuple.
    z: ClassVar[int] = 1
