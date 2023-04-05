from _typeshed import Incomplete

from openpyxl.descriptors.serialisable import Serialisable

class RichText(Serialisable):
    tagname: str
    bodyPr: Incomplete
    properties: Incomplete
    lstStyle: Incomplete
    p: Incomplete
    paragraphs: Incomplete
    __elements__: Incomplete
    def __init__(
        self, bodyPr: Incomplete | None = None, lstStyle: Incomplete | None = None, p: Incomplete | None = None
    ) -> None: ...

class Text(Serialisable):
    tagname: str
    strRef: Incomplete
    rich: Incomplete
    __elements__: Incomplete
    def __init__(self, strRef: Incomplete | None = None, rich: Incomplete | None = None) -> None: ...
    def to_tree(self, tagname: Incomplete | None = None, idx: Incomplete | None = None, namespace: Incomplete | None = None): ...
