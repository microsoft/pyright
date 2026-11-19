from codecs import _ReadableStream, _WritableStream
from collections.abc import Callable, Mapping, Sequence
from logging import Logger
from typing import Any, ClassVar, Literal
from typing_extensions import Self
from xml.etree.ElementTree import Element

from . import (
    blockparser,
    inlinepatterns,
    postprocessors as _postprocessors,
    preprocessors as _preprocessors,
    treeprocessors as _treeprocessors,
)
from .extensions import Extension
from .inlinepatterns import DelimiterProcessor
from .util import HtmlStash, Registry

__all__ = ["Markdown", "markdown", "markdownFromFile"]

logger: Logger

class Markdown:
    doc_tag: ClassVar[str]
    output_formats: ClassVar[dict[Literal["xhtml", "html"], Callable[[Element], str]]]

    last_run: float
    tab_length: int
    ESCAPED_CHARS: list[str]
    block_level_elements: list[str]
    registeredExtensions: list[Extension]
    stripTopLevelTags: bool
    delimiters: DelimiterProcessor | None

    # Set by build_parser().
    preprocessors: Registry[_preprocessors.Preprocessor]
    parser: blockparser.BlockParser
    inlinePatterns: Registry[inlinepatterns.Pattern]
    treeprocessors: Registry[_treeprocessors.Treeprocessor]
    postprocessors: Registry[_postprocessors.Postprocessor]

    references: dict[str, tuple[str, str]]
    htmlStash: HtmlStash

    # Set by set_output_format().
    output_format: Literal["xhtml", "html"]
    serializer: Callable[[Element], str]

    def __init__(
        self,
        *,
        extensions: Sequence[str | Extension] | None = ...,
        extension_configs: Mapping[str, Mapping[str, Any]] | None = ...,
        output_format: Literal["xhtml", "html"] | None = ...,
        tab_length: int | None = ...,
    ) -> None: ...
    def build_parser(self) -> Self: ...
    def registerExtensions(self, extensions: Sequence[Extension | str], configs: Mapping[str, dict[str, Any]]) -> Self: ...
    def build_extension(self, ext_name: str, configs: Mapping[str, Any]) -> Extension: ...
    def registerExtension(self, extension: Extension) -> Self: ...
    def reset(self) -> Self: ...
    def set_output_format(self, format: Literal["xhtml", "html"]) -> Self: ...
    def is_block_level(self, tag: object) -> bool: ...
    def convert(self, source: str) -> str: ...
    def convertFile(
        self, input: str | _ReadableStream | None = None, output: str | _WritableStream | None = None, encoding: str | None = None
    ) -> Self: ...

def markdown(
    text: str,
    *,
    extensions: Sequence[str | Extension] | None = ...,
    extension_configs: Mapping[str, Mapping[str, Any]] | None = ...,
    output_format: Literal["xhtml", "html"] | None = ...,
    tab_length: int | None = ...,
) -> str: ...
def markdownFromFile(
    *,
    input: str | _ReadableStream | None = ...,
    output: str | _WritableStream | None = ...,
    encoding: str | None = ...,
    extensions: Sequence[str | Extension] | None = ...,
    extension_configs: Mapping[str, Mapping[str, Any]] | None = ...,
    output_format: Literal["xhtml", "html"] | None = ...,
    tab_length: int | None = ...,
) -> None: ...
