# This sample tests instance variables initialized in __new__.

from typing import Self


class A:
    __slots__ = ("initialized", "conditional")

    def __new__(cls, value: int, initialize: bool) -> Self:
        self = super().__new__(cls)
        self.initialized = value
        if initialize:
            self.conditional = value
        return self
