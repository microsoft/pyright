# This sample is used in conjunction with final12.py to test that a module-scope
# "Final" whose initializer is not a literal keeps its declared type. The
# initializer must not be evaluated in a context that drops the contextual type
# supplied by the declaration, or the declaration is left unvalidated.

from typing import Callable, Final

# This should generate an error because the lambda returns an int, not a str.
CALLBACK_BAD: Final[Callable[[int], str]] = lambda value: value

CALLBACK_OK: Final[Callable[[int], str]] = lambda value: str(value)

CALLBACK_TYPE: Final[Callable[[str], int]] = len

ITEMS: Final[list[int]] = [1, 2]
