# This sample tests that `__iter__ = None` disables iteration even
# when `__getitem__` is defined. CPython raises TypeError in this case.


class SequenceProtocol:
    def __getitem__(self, item: int) -> int:
        if item >= 3:
            raise IndexError
        return item


# The legacy sequence protocol should still be iterable.
for _ in SequenceProtocol():
    pass


class IterNone:
    def __getitem__(self, item: int) -> int:
        return item

    __iter__ = None


# This should generate an error because __iter__ is None.
for _ in IterNone():
    pass


class IterNoneSubclass(IterNone):
    pass


# This should generate an error because __iter__ is None.
for _ in IterNoneSubclass():
    pass


class IterRestored(IterNone):
    def __iter__(self):
        yield 1


for _ in IterRestored():
    pass
