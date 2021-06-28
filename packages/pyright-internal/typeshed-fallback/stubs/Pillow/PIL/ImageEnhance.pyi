from typing import Any

class _Enhance:
    def enhance(self, factor): ...

class Color(_Enhance):
    image: Any
    intermediate_mode: str
    degenerate: Any
    def __init__(self, image) -> None: ...

class Contrast(_Enhance):
    image: Any
    degenerate: Any
    def __init__(self, image) -> None: ...

class Brightness(_Enhance):
    image: Any
    degenerate: Any
    def __init__(self, image) -> None: ...

class Sharpness(_Enhance):
    image: Any
    degenerate: Any
    def __init__(self, image) -> None: ...
