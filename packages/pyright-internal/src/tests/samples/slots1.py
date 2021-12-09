# This sample tests the type checker's validation of instance
# variables that are declared in the __slots__ attribute.


class NoSlots1:
    def __init__(self):
        self.x = 1


class NoSlots2:
    # Only lists and tuples of simple strings are supported, so this
    # will be treated as though there are no slots.
    __slots__ = {"aaa": 3}

    def __init__(self):
        self.x = 1


class NoSlots3:
    # Only lists and tuples of simple strings are supported, so this
    # will be treated as though there are no slots.
    __slots__ = ("aaa", f"test{3 + 4}")

    def __init__(self):
        self.x = 1


class Slots1(object):
    __slots__ = ("bbb", "ccc")

    def __init__(self):
        self.bbb = 1
        self.ccc = 1
        self.prop = 1

        # This should generate an error
        self.ddd = 1

    @property
    def prop(self):
        pass

    @prop.setter
    def prop(self, val: int):
        pass


class Slots1_1(Slots1):
    __slots__ = ["ddd", "eee"]

    def __init__(self):
        self.bbb = 1
        self.ccc = 1
        self.ddd = 1

        # This should generate an error
        self.fff = 1


class NoSlots1_1(Slots1, NoSlots2):
    def __init__(self):
        self.bbb = 1
        self.fff = 1
