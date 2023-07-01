# This sample tests the case where properties are unannotated,
# and the type needs to be determined via inference.


class ClassA:
    def __init__(self):
        self._x = None

    @property
    def x(self):
        return self._x

    @x.setter
    def x(self, value):
        self._x = value


c = ClassA()
reveal_type(c.x, expected_text="Unknown | None")
