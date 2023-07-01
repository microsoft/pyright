from _typeshed import Incomplete, ReadableBuffer, Unused
from typing import IO, AnyStr, overload
from typing_extensions import Literal
from xml.dom.minidom import Document as _Document, Element as _Element, Node

def getChildElementsByTagName(self: Node, tagName: str) -> list[Element]: ...
def getFirstChildElementByTagName(self: Node, tagName: str) -> Element | None: ...

class Document(_Document):
    cE = _Document.createElement
    cT = _Document.createTextNode
    aChild = _Document.appendChild
    getEByTN = _Document.getElementsByTagName
    getCEByTN = getChildElementsByTagName
    getFCEByTN = getFirstChildElementByTagName

class Element(_Element):
    getA = _Element.getAttribute
    remA = _Element.removeAttribute
    setA = _Element.setAttribute
    aChild = _Element.appendChild
    getEByTN = _Element.getElementsByTagName
    getCEByTN = getChildElementsByTagName
    getFCEByTN = getFirstChildElementByTagName

# Used by other types referenced in https://pyinstaller.org/en/stable/spec-files.html#spec-file-operation
class Manifest:
    filename: Incomplete
    optional: Incomplete
    manifestType: Incomplete
    manifestVersion: Incomplete
    noInheritable: Incomplete
    noInherit: Incomplete
    type: Incomplete
    name: Incomplete
    language: str | None
    processorArchitecture: Incomplete
    version: Incomplete
    publicKeyToken: Incomplete
    applyPublisherPolicy: Incomplete
    description: Incomplete
    requestedExecutionLevel: Incomplete
    uiAccess: Incomplete
    dependentAssemblies: Incomplete
    bindingRedirects: Incomplete
    files: Incomplete
    comInterfaceExternalProxyStubs: Incomplete
    def __init__(
        self,
        manifestType: str = "assembly",
        manifestVersion: Incomplete | None = None,
        noInheritable: bool = False,
        noInherit: bool = False,
        type_: Incomplete | None = None,
        name: Incomplete | None = None,
        language: str | None = None,
        processorArchitecture: Incomplete | None = None,
        version: Incomplete | None = None,
        publicKeyToken: Incomplete | None = None,
        description: Unused = None,
        requestedExecutionLevel: Incomplete | None = None,
        uiAccess: Incomplete | None = None,
        dependentAssemblies: Incomplete | None = None,
        files: Incomplete | None = None,
        comInterfaceExternalProxyStubs: Incomplete | None = None,
    ) -> None: ...
    @overload
    def __eq__(self, other: Manifest | str) -> bool: ...  # type: ignore[misc]
    @overload
    def __eq__(self, other: object) -> Literal[False]: ...
    @overload
    def __ne__(self, other: Manifest | str) -> bool: ...  # type: ignore[misc]
    @overload
    def __ne__(self, other: object) -> Literal[True]: ...
    def add_dependent_assembly(
        self,
        manifestVersion: Incomplete | None = None,
        noInheritable: bool = False,
        noInherit: bool = False,
        type_: Incomplete | None = None,
        name: Incomplete | None = None,
        language: str | None = None,
        processorArchitecture: Incomplete | None = None,
        version: Incomplete | None = None,
        publicKeyToken: Incomplete | None = None,
        description: Incomplete | None = None,
        requestedExecutionLevel: Incomplete | None = None,
        uiAccess: Incomplete | None = None,
        dependentAssemblies: Incomplete | None = None,
        files: Incomplete | None = None,
        comInterfaceExternalProxyStubs: Incomplete | None = None,
    ) -> None: ...
    def add_file(
        self,
        name: str = "",
        hashalg: str = "",
        hash: str = "",
        comClasses: Incomplete | None = None,
        typelibs: Incomplete | None = None,
        comInterfaceProxyStubs: Incomplete | None = None,
        windowClasses: Incomplete | None = None,
    ) -> None: ...
    @classmethod
    def get_winsxs_dir(cls) -> str: ...
    @classmethod
    def get_manifest_dir(cls) -> str: ...
    @classmethod
    def get_policy_dir(cls) -> str: ...
    def get_policy_redirect(self, language: str | None = None, version: Incomplete | None = None) -> Incomplete: ...
    def find_files(self, ignore_policies: bool = True) -> list[Incomplete]: ...
    def getid(self, language: str | None = None, version: Incomplete | None = None) -> str: ...
    def getlanguage(self, language: str | None = None, windowsversion: Incomplete | None = None) -> str: ...
    def getpolicyid(self, fuzzy: bool = True, language: str | None = None, windowsversion: Incomplete | None = None) -> str: ...
    def load_dom(self, domtree: Document | Element, initialize: bool = True) -> None: ...
    def parse(self, filename_or_file: str | IO[AnyStr], initialize: bool = True) -> None: ...
    def parse_string(self, xmlstr: ReadableBuffer | str, initialize: bool = True) -> None: ...
    def same_id(self, manifest: Manifest, skip_version_check: bool = False) -> bool: ...
    def todom(self) -> Document: ...
    def toprettyxml(self, indent: str = "  ", newl: str = ..., encoding: str = "UTF-8") -> str: ...
    def toxml(self, encoding: str = "UTF-8") -> str: ...
    def update_resources(self, dstpath: str, names: Incomplete | None = None, languages: Incomplete | None = None) -> None: ...
    def writeprettyxml(
        self, filename_or_file: str | IO[AnyStr] | None = None, indent: str = "  ", newl: str = ..., encoding: str = "UTF-8"
    ) -> None: ...
    def writexml(
        self, filename_or_file: str | IO[AnyStr] | None = None, indent: Unused = "  ", newl: Unused = ..., encoding: str = "UTF-8"
    ) -> None: ...
