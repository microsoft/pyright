from _typeshed import Incomplete
from typing_extensions import Literal

from openpyxl.chart.data_source import NumFmt
from openpyxl.descriptors import Strict, Typed
from openpyxl.descriptors.nested import NestedMinMax
from openpyxl.descriptors.serialisable import Serialisable

class NestedGapAmount(NestedMinMax):
    allow_none: bool
    min: float
    max: float

class NestedOverlap(NestedMinMax):
    allow_none: bool
    min: float
    max: float

class NumberFormatDescriptor(Typed[NumFmt, Incomplete]):
    expected_type: type[NumFmt]
    allow_none: Literal[True]
    def __set__(self, instance: Serialisable | Strict, value) -> None: ...
