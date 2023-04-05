from _typeshed import Incomplete

from openpyxl.descriptors.serialisable import Serialisable

class WebPublishItem(Serialisable):
    tagname: str
    id: Incomplete
    divId: Incomplete
    sourceType: Incomplete
    sourceRef: Incomplete
    sourceObject: Incomplete
    destinationFile: Incomplete
    title: Incomplete
    autoRepublish: Incomplete
    def __init__(
        self,
        id: Incomplete | None = None,
        divId: Incomplete | None = None,
        sourceType: Incomplete | None = None,
        sourceRef: Incomplete | None = None,
        sourceObject: Incomplete | None = None,
        destinationFile: Incomplete | None = None,
        title: Incomplete | None = None,
        autoRepublish: Incomplete | None = None,
    ) -> None: ...

class WebPublishItems(Serialisable):
    tagname: str
    count: Incomplete
    webPublishItem: Incomplete
    __elements__: Incomplete
    def __init__(self, count: Incomplete | None = None, webPublishItem: Incomplete | None = None) -> None: ...
