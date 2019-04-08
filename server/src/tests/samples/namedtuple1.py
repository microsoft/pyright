from typing import NamedTuple

"""

Following code is supported by Python 3.7, and therefore should also be accepted by pyright.

"""

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
