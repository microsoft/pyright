from _typeshed import Incomplete, Unused
from typing import ClassVar
from typing_extensions import Literal

from openpyxl.chart.data_source import NumDataSource
from openpyxl.chart.shapes import GraphicalProperties
from openpyxl.descriptors.base import Alias, Typed
from openpyxl.descriptors.excel import ExtensionList
from openpyxl.descriptors.serialisable import Serialisable

class ErrorBars(Serialisable):
    tagname: str
    errDir: Incomplete
    direction: Alias
    errBarType: Incomplete
    style: Alias
    errValType: Incomplete
    size: Alias
    noEndCap: Incomplete
    plus: Typed[NumDataSource, Literal[True]]
    minus: Typed[NumDataSource, Literal[True]]
    val: Incomplete
    spPr: Typed[GraphicalProperties, Literal[True]]
    graphicalProperties: Alias
    extLst: Typed[ExtensionList, Literal[True]]
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(
        self,
        errDir: Incomplete | None = None,
        errBarType: str = "both",
        errValType: str = "fixedVal",
        noEndCap: Incomplete | None = None,
        plus: NumDataSource | None = None,
        minus: NumDataSource | None = None,
        val: Incomplete | None = None,
        spPr: GraphicalProperties | None = None,
        extLst: Unused = None,
    ) -> None: ...
