# This sample validates the Python 3.7 data class feature.

from typing import NamedTuple

class Other:
    pass

class DataTuple(NamedTuple):
    def _m(self):
        pass
    id: int
    aid: Other
    valll: str = ''

d1 = DataTuple(id=1, aid=Other())
d2 = DataTuple(id=1, aid=Other(), valll='v')
id = d1.id
