from _typeshed import Incomplete, Unused
from typing import ClassVar
from typing_extensions import Literal

from openpyxl.descriptors.base import Typed
from openpyxl.descriptors.serialisable import Serialisable

def get_version(): ...

class DigSigBlob(Serialisable):
    __elements__: ClassVar[tuple[str, ...]]
    __attrs__: ClassVar[tuple[str, ...]]

class VectorLpstr(Serialisable):
    __elements__: ClassVar[tuple[str, ...]]
    __attrs__: ClassVar[tuple[str, ...]]

class VectorVariant(Serialisable):
    __elements__: ClassVar[tuple[str, ...]]
    __attrs__: ClassVar[tuple[str, ...]]

class ExtendedProperties(Serialisable):
    tagname: str
    Template: Incomplete
    Manager: Incomplete
    Company: Incomplete
    Pages: Incomplete
    Words: Incomplete
    Characters: Incomplete
    PresentationFormat: Incomplete
    Lines: Incomplete
    Paragraphs: Incomplete
    Slides: Incomplete
    Notes: Incomplete
    TotalTime: Incomplete
    HiddenSlides: Incomplete
    MMClips: Incomplete
    ScaleCrop: Incomplete
    HeadingPairs: Typed[VectorVariant, Literal[True]]
    TitlesOfParts: Typed[VectorLpstr, Literal[True]]
    LinksUpToDate: Incomplete
    CharactersWithSpaces: Incomplete
    SharedDoc: Incomplete
    HyperlinkBase: Incomplete
    HLinks: Typed[VectorVariant, Literal[True]]
    HyperlinksChanged: Incomplete
    DigSig: Typed[DigSigBlob, Literal[True]]
    Application: Incomplete
    AppVersion: Incomplete
    DocSecurity: Incomplete
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(
        self,
        Template: Incomplete | None = None,
        Manager: Incomplete | None = None,
        Company: Incomplete | None = None,
        Pages: Incomplete | None = None,
        Words: Incomplete | None = None,
        Characters: Incomplete | None = None,
        PresentationFormat: Incomplete | None = None,
        Lines: Incomplete | None = None,
        Paragraphs: Incomplete | None = None,
        Slides: Incomplete | None = None,
        Notes: Incomplete | None = None,
        TotalTime: Incomplete | None = None,
        HiddenSlides: Incomplete | None = None,
        MMClips: Incomplete | None = None,
        ScaleCrop: Incomplete | None = None,
        HeadingPairs: Unused = None,
        TitlesOfParts: Unused = None,
        LinksUpToDate: Incomplete | None = None,
        CharactersWithSpaces: Incomplete | None = None,
        SharedDoc: Incomplete | None = None,
        HyperlinkBase: Incomplete | None = None,
        HLinks: Unused = None,
        HyperlinksChanged: Incomplete | None = None,
        DigSig: Unused = None,
        Application: str = "Microsoft Excel",
        AppVersion: Incomplete | None = None,
        DocSecurity: Incomplete | None = None,
    ) -> None: ...
    def to_tree(self): ...
