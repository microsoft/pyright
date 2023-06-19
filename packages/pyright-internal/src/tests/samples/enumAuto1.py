# This sample tests enum types with auto() values.

from enum import Enum, auto


class CacheBehavior(Enum):
    ALWAYS = auto()
    NEVER = auto()
    AUTO = auto()


a: CacheBehavior = CacheBehavior.ALWAYS
b: CacheBehavior = CacheBehavior["ALWAYS"]
foo = "A" + "UTO"
c: CacheBehavior = CacheBehavior[foo]
