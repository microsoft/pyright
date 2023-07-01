from re import Pattern
from typing_extensions import Final
from xml.etree.ElementTree import Element as Element  # possibly also imported from lxml

NS_REGEX: Final[Pattern[str]]

def localname(node): ...
def whitespace(node) -> None: ...
