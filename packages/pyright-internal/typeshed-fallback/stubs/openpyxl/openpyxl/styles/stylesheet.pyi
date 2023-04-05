from _typeshed import Incomplete

from openpyxl.descriptors.serialisable import Serialisable

class Stylesheet(Serialisable):
    tagname: str
    numFmts: Incomplete
    fonts: Incomplete
    fills: Incomplete
    borders: Incomplete
    cellStyleXfs: Incomplete
    cellXfs: Incomplete
    cellStyles: Incomplete
    dxfs: Incomplete
    tableStyles: Incomplete
    colors: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    number_formats: Incomplete
    cell_styles: Incomplete
    alignments: Incomplete
    protections: Incomplete
    named_styles: Incomplete
    def __init__(
        self,
        numFmts: Incomplete | None = None,
        fonts=(),
        fills=(),
        borders=(),
        cellStyleXfs: Incomplete | None = None,
        cellXfs: Incomplete | None = None,
        cellStyles: Incomplete | None = None,
        dxfs=(),
        tableStyles: Incomplete | None = None,
        colors: Incomplete | None = None,
        extLst: Incomplete | None = None,
    ) -> None: ...
    @classmethod
    def from_tree(cls, node): ...
    @property
    def custom_formats(self): ...
    def to_tree(self, tagname: Incomplete | None = None, idx: Incomplete | None = None, namespace: Incomplete | None = None): ...

def apply_stylesheet(archive, wb): ...
def write_stylesheet(wb): ...
