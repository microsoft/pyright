from _typeshed import Incomplete
from typing import ClassVar

from openpyxl.descriptors import DateTime
from openpyxl.descriptors.base import Alias
from openpyxl.descriptors.nested import NestedText
from openpyxl.descriptors.serialisable import Serialisable

# Does not reimplement the relevant methods, so runtime also has incompatible supertypes
class NestedDateTime(DateTime[Incomplete], NestedText):  # type: ignore[misc]
    expected_type: type[Incomplete]
    def to_tree(
        self, tagname: Incomplete | None = None, value: Incomplete | None = None, namespace: Incomplete | None = None
    ): ...

class QualifiedDateTime(NestedDateTime):
    def to_tree(
        self, tagname: Incomplete | None = None, value: Incomplete | None = None, namespace: Incomplete | None = None
    ): ...

class DocumentProperties(Serialisable):
    tagname: str
    namespace: Incomplete
    category: Incomplete
    contentStatus: Incomplete
    keywords: Incomplete
    lastModifiedBy: Incomplete
    lastPrinted: Incomplete
    revision: Incomplete
    version: Incomplete
    last_modified_by: Alias
    subject: Incomplete
    title: Incomplete
    creator: Incomplete
    description: Incomplete
    identifier: Incomplete
    language: Incomplete
    created: Incomplete
    modified: Incomplete
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(
        self,
        category: Incomplete | None = None,
        contentStatus: Incomplete | None = None,
        keywords: Incomplete | None = None,
        lastModifiedBy: Incomplete | None = None,
        lastPrinted: Incomplete | None = None,
        revision: Incomplete | None = None,
        version: Incomplete | None = None,
        created=None,
        creator: str = "openpyxl",
        description: Incomplete | None = None,
        identifier: Incomplete | None = None,
        language: Incomplete | None = None,
        modified=None,
        subject: Incomplete | None = None,
        title: Incomplete | None = None,
    ) -> None: ...
