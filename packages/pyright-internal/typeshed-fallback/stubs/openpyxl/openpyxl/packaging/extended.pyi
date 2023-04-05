from _typeshed import Incomplete

from openpyxl.descriptors.serialisable import Serialisable

def get_version(): ...

class DigSigBlob(Serialisable):  # type: ignore[misc]
    __elements__: Incomplete
    __attrs__: Incomplete

class VectorLpstr(Serialisable):  # type: ignore[misc]
    __elements__: Incomplete
    __attrs__: Incomplete

class VectorVariant(Serialisable):  # type: ignore[misc]
    __elements__: Incomplete
    __attrs__: Incomplete

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
    HeadingPairs: Incomplete
    TitlesOfParts: Incomplete
    LinksUpToDate: Incomplete
    CharactersWithSpaces: Incomplete
    SharedDoc: Incomplete
    HyperlinkBase: Incomplete
    HLinks: Incomplete
    HyperlinksChanged: Incomplete
    DigSig: Incomplete
    Application: Incomplete
    AppVersion: Incomplete
    DocSecurity: Incomplete
    __elements__: Incomplete
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
        HeadingPairs: Incomplete | None = None,
        TitlesOfParts: Incomplete | None = None,
        LinksUpToDate: Incomplete | None = None,
        CharactersWithSpaces: Incomplete | None = None,
        SharedDoc: Incomplete | None = None,
        HyperlinkBase: Incomplete | None = None,
        HLinks: Incomplete | None = None,
        HyperlinksChanged: Incomplete | None = None,
        DigSig: Incomplete | None = None,
        Application: str = "Microsoft Excel",
        AppVersion: Incomplete | None = None,
        DocSecurity: Incomplete | None = None,
    ) -> None: ...
    def to_tree(self): ...
