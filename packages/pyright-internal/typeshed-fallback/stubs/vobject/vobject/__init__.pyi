from typing import Final

from .base import Component

def iCalendar() -> Component: ...
def vCard() -> Component: ...

VERSION: Final[str]
