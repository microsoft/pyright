from typing import Any, Callable, Container, Dict, Iterable, List, Optional, Pattern, Text, Union

from .html5lib_shim import BleachHTMLParser, BleachHTMLSerializer, SanitizerFilter

ALLOWED_TAGS: List[Text]
ALLOWED_ATTRIBUTES: Dict[Text, List[Text]]
ALLOWED_STYLES: List[Text]
ALLOWED_PROTOCOLS: List[Text]

INVISIBLE_CHARACTERS: Text
INVISIBLE_CHARACTERS_RE: Pattern[Text]
INVISIBLE_REPLACEMENT_CHAR: Text

# A html5lib Filter class
_Filter = Any

class Cleaner(object):
    tags: Container[Text]
    attributes: _Attributes
    styles: Container[Text]
    protocols: Container[Text]
    strip: bool
    strip_comments: bool
    filters: Iterable[_Filter]
    parser: BleachHTMLParser
    walker: Any
    serializer: BleachHTMLSerializer
    def __init__(
        self,
        tags: Container[Text] = ...,
        attributes: _Attributes = ...,
        styles: Container[Text] = ...,
        protocols: Container[Text] = ...,
        strip: bool = ...,
        strip_comments: bool = ...,
        filters: Optional[Iterable[_Filter]] = ...,
    ) -> None: ...
    def clean(self, text: Text) -> Text: ...

_AttributeFilter = Callable[[Text, Text, Text], bool]
_AttributeDict = Union[Dict[Text, Union[List[Text], _AttributeFilter]], Dict[Text, List[Text]], Dict[Text, _AttributeFilter]]
_Attributes = Union[_AttributeFilter, _AttributeDict, List[Text]]

def attribute_filter_factory(attributes: _Attributes) -> _AttributeFilter: ...

class BleachSanitizerFilter(SanitizerFilter):
    attr_filter: _AttributeFilter
    strip_disallowed_elements: bool
    strip_html_comments: bool
    def __init__(
        self,
        source,
        attributes: _Attributes = ...,
        strip_disallowed_elements: bool = ...,
        strip_html_comments: bool = ...,
        **kwargs,
    ) -> None: ...
    def sanitize_stream(self, token_iterator): ...
    def merge_characters(self, token_iterator): ...
    def __iter__(self): ...
    def sanitize_token(self, token): ...
    def sanitize_characters(self, token): ...
    def sanitize_uri_value(self, value, allowed_protocols): ...
    def allow_token(self, token): ...
    def disallowed_token(self, token): ...
    def sanitize_css(self, style): ...
