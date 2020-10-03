# This sample tests the error reporting for static and class methods
# used with property getters, setters and deleters.


class Foo1:
    @property
    def legal1(self) -> None:
        pass

    # This should generate an error.
    @property
    @staticmethod
    def illegal1() -> None:
        pass

    # This should generate an error.
    @illegal1.setter
    @staticmethod
    def illegal1(val: None) -> None:
        pass

    # This should generate an error.
    @illegal1.deleter
    @staticmethod
    def illegal1() -> None:
        pass

    # This should generate an error.
    @property
    @classmethod
    def illegal2(cls) -> None:
        pass

    # This should generate an error.
    @illegal2.setter
    @classmethod
    def illegal2(cls, val: None) -> None:
        pass

    # This should generate an error.
    @illegal2.deleter
    @classmethod
    def illegal2(cls) -> None:
        pass
