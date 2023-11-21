from re import Match, Pattern
from typing import Any
from xml.etree.ElementTree import Element

from markdown import blockparser
from markdown.blockprocessors import BlockProcessor
from markdown.extensions import Extension

class AdmonitionExtension(Extension): ...

class AdmonitionProcessor(BlockProcessor):
    CLASSNAME: str
    CLASSNAME_TITLE: str
    RE: Pattern[str]
    RE_SPACES: Any
    def __init__(self, parser: blockparser.BlockParser): ...
    def parse_content(self, parent: Element, block: str) -> tuple[Element | None, str, str]: ...
    def get_class_and_title(self, match: Match[str]) -> tuple[str, str | None]: ...

def makeExtension(**kwargs) -> AdmonitionExtension: ...
