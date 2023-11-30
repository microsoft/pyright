# This sample tests the deprecation messages for class properties.


class A:
    @classmethod
    @property
    # This should generate an error if reportDeprecated is enabled.
    def prop1(cls) -> int:
        return 1

    @classmethod
    @prop1.setter
    # This should generate an error if reportDeprecated is enabled.
    def prop1(cls, value: int) -> None:
        pass
