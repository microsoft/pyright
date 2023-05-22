from _typeshed import Incomplete
from typing import ClassVar
from typing_extensions import Literal

from openpyxl.descriptors.base import Alias, Bool, Integer, String, _ConvertibleToBool, _ConvertibleToInt
from openpyxl.descriptors.serialisable import Serialisable

class WorkbookProtection(Serialisable):
    tagname: str
    workbook_password: Alias
    workbookPasswordCharacterSet: String[Literal[True]]
    revision_password: Alias
    revisionsPasswordCharacterSet: String[Literal[True]]
    lockStructure: Bool[Literal[True]]
    lock_structure: Alias
    lockWindows: Bool[Literal[True]]
    lock_windows: Alias
    lockRevision: Bool[Literal[True]]
    lock_revision: Alias
    revisionsAlgorithmName: String[Literal[True]]
    revisionsHashValue: Incomplete
    revisionsSaltValue: Incomplete
    revisionsSpinCount: Integer[Literal[True]]
    workbookAlgorithmName: String[Literal[True]]
    workbookHashValue: Incomplete
    workbookSaltValue: Incomplete
    workbookSpinCount: Integer[Literal[True]]
    __attrs__: ClassVar[tuple[str, ...]]
    def __init__(
        self,
        workbookPassword: Incomplete | None = None,
        workbookPasswordCharacterSet: str | None = None,
        revisionsPassword: Incomplete | None = None,
        revisionsPasswordCharacterSet: str | None = None,
        lockStructure: _ConvertibleToBool | None = None,
        lockWindows: _ConvertibleToBool | None = None,
        lockRevision: _ConvertibleToBool | None = None,
        revisionsAlgorithmName: str | None = None,
        revisionsHashValue: Incomplete | None = None,
        revisionsSaltValue: Incomplete | None = None,
        revisionsSpinCount: _ConvertibleToInt | None = None,
        workbookAlgorithmName: str | None = None,
        workbookHashValue: Incomplete | None = None,
        workbookSaltValue: Incomplete | None = None,
        workbookSpinCount: _ConvertibleToInt | None = None,
    ) -> None: ...
    def set_workbook_password(self, value: str = "", already_hashed: bool = False) -> None: ...
    @property
    def workbookPassword(self): ...
    @workbookPassword.setter
    def workbookPassword(self, value) -> None: ...
    def set_revisions_password(self, value: str = "", already_hashed: bool = False) -> None: ...
    @property
    def revisionsPassword(self): ...
    @revisionsPassword.setter
    def revisionsPassword(self, value) -> None: ...
    @classmethod
    def from_tree(cls, node): ...

DocumentSecurity = WorkbookProtection

class FileSharing(Serialisable):
    tagname: str
    readOnlyRecommended: Bool[Literal[True]]
    userName: String[Literal[True]]
    reservationPassword: Incomplete
    algorithmName: String[Literal[True]]
    hashValue: Incomplete
    saltValue: Incomplete
    spinCount: Integer[Literal[True]]
    def __init__(
        self,
        readOnlyRecommended: _ConvertibleToBool | None = None,
        userName: str | None = None,
        reservationPassword: Incomplete | None = None,
        algorithmName: str | None = None,
        hashValue: Incomplete | None = None,
        saltValue: Incomplete | None = None,
        spinCount: _ConvertibleToInt | None = None,
    ) -> None: ...
