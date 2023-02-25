# This sample tests that a method can be satisfied by a metaclass
# when doing protocol matching.

from typing import Iterator


class StyleMeta(type):
    def __iter__(cls) -> Iterator[str]:
        yield "a"
        yield "b"
        yield "c"


class Style(metaclass=StyleMeta):
    pass


x: type[Style] = Style
print(list(x))
