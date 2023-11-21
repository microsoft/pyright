from re import Pattern
from xml.etree.ElementTree import Element

from markdown.extensions import Extension
from markdown.treeprocessors import Treeprocessor

def get_attrs(str: str) -> list[tuple[str, str]]: ...
def isheader(elem: Element) -> bool: ...

class AttrListTreeprocessor(Treeprocessor):
    BASE_RE: str
    HEADER_RE: Pattern[str]
    BLOCK_RE: Pattern[str]
    INLINE_RE: Pattern[str]
    NAME_RE: Pattern[str]
    def assign_attrs(self, elem: Element, attrs: str) -> None: ...
    def sanitize_name(self, name: str) -> str: ...

class AttrListExtension(Extension): ...

def makeExtension(**kwargs) -> AttrListExtension: ...
