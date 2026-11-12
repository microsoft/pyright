from _typeshed import Incomplete
from typing import ClassVar

class Replayable:
    type: ClassVar[str | None]
    def replay(self, formatter) -> None: ...

def __getattr__(name: str) -> Incomplete: ...
