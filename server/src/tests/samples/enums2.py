# This sample tests enum types with auto() values.

from enum import Enum, auto
class CacheBehaviour(Enum):
    ALWAYS = auto()
    NEVER = auto()
    AUTO = auto()

