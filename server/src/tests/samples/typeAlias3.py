# This sample tests that type aliases can consist of
# partially-specialized classes that can be further
# specialized.

# pyright: strict

from typing import Tuple, Optional, TypeVar

T = TypeVar('T')

ValidationResult = Tuple[bool, Optional[T]]

def foo() -> ValidationResult[str]:
    return False, 'valid'

