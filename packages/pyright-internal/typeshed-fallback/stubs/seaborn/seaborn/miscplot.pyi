from collections.abc import Sequence

from matplotlib.typing import ColorType

__all__ = ["palplot", "dogplot"]

def palplot(pal: Sequence[ColorType], size: int = 1) -> None: ...
def dogplot(*_, **__) -> None: ...
