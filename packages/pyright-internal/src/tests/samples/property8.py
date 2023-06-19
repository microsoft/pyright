# This sample tests the error reporting for static methods
# used with property getters, setters and deleters.


class ClassA:
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
