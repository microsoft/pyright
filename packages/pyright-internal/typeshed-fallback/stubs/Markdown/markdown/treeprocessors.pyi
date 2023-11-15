from re import Pattern
from typing import Any, ClassVar
from typing_extensions import TypeGuard
from xml.etree.ElementTree import Element

from markdown import util
from markdown.core import Markdown

def build_treeprocessors(md: Markdown, **kwargs) -> util.Registry[Treeprocessor]: ...
def isString(s: object) -> TypeGuard[str]: ...

class Treeprocessor(util.Processor):
    def run(self, root: Element) -> Element | None: ...

class InlineProcessor(Treeprocessor):
    inlinePatterns: Any
    ancestors: Any
    def __init__(self, md) -> None: ...
    stashed_nodes: Any
    parent_map: Any
    def run(self, tree: Element, ancestors: list[str] | None = None) -> Element: ...

class PrettifyTreeprocessor(Treeprocessor): ...

class UnescapeTreeprocessor(Treeprocessor):
    RE: ClassVar[Pattern[str]]
    def unescape(self, text: str) -> str: ...
