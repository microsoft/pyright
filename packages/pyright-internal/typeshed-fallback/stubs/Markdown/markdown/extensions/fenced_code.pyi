from re import Pattern
from typing import Any, ClassVar

from markdown.core import Markdown
from markdown.extensions import Extension
from markdown.preprocessors import Preprocessor

class FencedCodeExtension(Extension): ...

class FencedBlockPreprocessor(Preprocessor):
    FENCED_BLOCK_RE: ClassVar[Pattern[str]]
    codehilite_conf: dict[str, Any]
    def __init__(self, md: Markdown, config: dict[str, Any]) -> None: ...

def makeExtension(**kwargs) -> FencedCodeExtension: ...
