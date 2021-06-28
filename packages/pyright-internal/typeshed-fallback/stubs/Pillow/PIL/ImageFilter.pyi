from typing import Any

class Filter: ...
class MultibandFilter(Filter): ...

class BuiltinFilter(MultibandFilter):
    def filter(self, image): ...

class Kernel(BuiltinFilter):
    name: str
    filterargs: Any
    def __init__(self, size, kernel, scale: Any | None = ..., offset: int = ...): ...

class RankFilter(Filter):
    name: str
    size: Any
    rank: Any
    def __init__(self, size, rank) -> None: ...
    def filter(self, image): ...

class MedianFilter(RankFilter):
    name: str
    size: Any
    rank: Any
    def __init__(self, size: int = ...) -> None: ...

class MinFilter(RankFilter):
    name: str
    size: Any
    rank: int
    def __init__(self, size: int = ...) -> None: ...

class MaxFilter(RankFilter):
    name: str
    size: Any
    rank: Any
    def __init__(self, size: int = ...) -> None: ...

class ModeFilter(Filter):
    name: str
    size: Any
    def __init__(self, size: int = ...) -> None: ...
    def filter(self, image): ...

class GaussianBlur(MultibandFilter):
    name: str
    radius: Any
    def __init__(self, radius: int = ...) -> None: ...
    def filter(self, image): ...

class BoxBlur(MultibandFilter):
    name: str
    radius: Any
    def __init__(self, radius) -> None: ...
    def filter(self, image): ...

class UnsharpMask(MultibandFilter):
    name: str
    radius: Any
    percent: Any
    threshold: Any
    def __init__(self, radius: int = ..., percent: int = ..., threshold: int = ...) -> None: ...
    def filter(self, image): ...

class BLUR(BuiltinFilter):
    name: str
    filterargs: Any

class CONTOUR(BuiltinFilter):
    name: str
    filterargs: Any

class DETAIL(BuiltinFilter):
    name: str
    filterargs: Any

class EDGE_ENHANCE(BuiltinFilter):
    name: str
    filterargs: Any

class EDGE_ENHANCE_MORE(BuiltinFilter):
    name: str
    filterargs: Any

class EMBOSS(BuiltinFilter):
    name: str
    filterargs: Any

class FIND_EDGES(BuiltinFilter):
    name: str
    filterargs: Any

class SHARPEN(BuiltinFilter):
    name: str
    filterargs: Any

class SMOOTH(BuiltinFilter):
    name: str
    filterargs: Any

class SMOOTH_MORE(BuiltinFilter):
    name: str
    filterargs: Any

class Color3DLUT(MultibandFilter):
    name: str
    size: Any
    channels: Any
    mode: Any
    table: Any
    def __init__(self, size, table, channels: int = ..., target_mode: Any | None = ..., **kwargs) -> None: ...
    @classmethod
    def generate(cls, size, callback, channels: int = ..., target_mode: Any | None = ...): ...
    def transform(self, callback, with_normals: bool = ..., channels: Any | None = ..., target_mode: Any | None = ...): ...
    def filter(self, image): ...
