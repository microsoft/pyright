# This sample tests the case where a __new__ method provides
# a type that differs from the class that contains it.


class HelloWorld:
    def __new__(cls) -> str:
        return "Hello World"


v1 = HelloWorld()
reveal_type(v1, expected_text="str")
