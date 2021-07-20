# This sample validates the Python 3.7 data class feature.

from typing import ClassVar, Final, NamedTuple, Optional


class Other:
    pass


class DataTuple(NamedTuple):
    def _m(self):
        pass

    # ClassVar variables should not be included.
    class_var: ClassVar[int] = 4

    id: int
    aid: Other
    value: str = ""

    # Unannotated variables should not be included.
    not_annotated = 5

    name: Optional[str] = None

    name2: Final[Optional[str]] = None


d1 = DataTuple(id=1, aid=Other(), name2="hi")
d2 = DataTuple(id=1, aid=Other(), value="v")
d3 = DataTuple(id=1, aid=Other(), name="hello")
d4 = DataTuple(id=1, aid=Other(), name=None)
id = d1.id

# This should generate an error because the name argument
# is the incorrect type.
d5 = DataTuple(id=1, aid=Other(), name=3)

# This should generate an error because aid is a required
# parameter and is missing an argument here.
d6 = DataTuple(id=1, name=None)
