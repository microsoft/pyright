from _typeshed import Incomplete

from .Image import Image, _Box

def grab(
    bbox: _Box | None = None, include_layered_windows: bool = False, all_screens: bool = False, xdisplay: Incomplete | None = None
) -> Image: ...
def grabclipboard() -> Image | None: ...
