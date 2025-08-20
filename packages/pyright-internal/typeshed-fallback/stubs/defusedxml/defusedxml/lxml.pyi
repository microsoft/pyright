import threading
from _typeshed import Incomplete
from typing import Final, Literal, type_check_only

# Not bothering with types here as lxml support is supposed to be dropped in a future version of defusedxml

LXML3: bool
__origin__: Final = "lxml.etree"

def tostring(
    element_or_tree,
    *,
    encoding: str | None = None,
    method: Literal["xml", "html", "text", "c14n", "c14n2"] = "xml",
    xml_declaration: bool | None = None,
    pretty_print: bool = False,
    with_tail: bool = True,
    standalone: bool | None = None,
    doctype=None,
    exclusive: bool = False,
    inclusive_ns_prefixes=None,
    with_comments: bool = True,
    strip_text: bool = False,
): ...

# Should be imported from lxml.etree.ElementBase, but lxml lacks types
@type_check_only
class _ElementBase: ...

class RestrictedElement(_ElementBase):
    blacklist: Incomplete
    def __iter__(self): ...
    def iterchildren(self, tag: Incomplete | None = ..., reversed: bool = ...): ...
    def iter(self, tag: Incomplete | None = ..., *tags): ...
    def iterdescendants(self, tag: Incomplete | None = ..., *tags): ...
    def itersiblings(self, tag: Incomplete | None = ..., preceding: bool = ...): ...
    def getchildren(self): ...
    def getiterator(self, tag: Incomplete | None = ...): ...

class GlobalParserTLS(threading.local):
    parser_config: Incomplete
    element_class: Incomplete
    def createDefaultParser(self): ...
    def setDefaultParser(self, parser) -> None: ...
    def getDefaultParser(self): ...

def getDefaultParser(): ...
def check_docinfo(elementtree, forbid_dtd: bool = False, forbid_entities: bool = True) -> None: ...
def parse(
    source,
    parser: Incomplete | None = ...,
    base_url: Incomplete | None = ...,
    forbid_dtd: bool = ...,
    forbid_entities: bool = ...,
): ...
def fromstring(
    text, parser: Incomplete | None = ..., base_url: Incomplete | None = ..., forbid_dtd: bool = ..., forbid_entities: bool = ...
): ...

XML = fromstring

def iterparse(*args, **kwargs) -> None: ...
