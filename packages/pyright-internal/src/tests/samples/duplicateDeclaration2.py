# This sample tests the detection of duplicate (overwritten)
# properties.

# pyright: strict


class MyClass:
    def __init__(self):
        self._property: str = ""

    # This should generate an error because "prop"
    # is overwritten below.
    @property
    def prop(self):
        return self._property

    # This should generate an error because "prop"
    # is overwritten below.
    @prop.setter
    def prop(self, val: str):
        self._property = val

    # This should generate an error because "prop"
    # is overwritten below.
    @prop.deleter
    def prop(self):
        pass

    # This should generate an error because "prop"
    # is overwritten below.
    @property
    def prop(self):
        return self._property

    @property
    def prop(self):
        return self._property

    @prop.setter
    def prop(self, val: str):
        self._property = val

    @prop.deleter
    def prop(self):
        pass
