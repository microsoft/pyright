# This sample tests the ability of the type checker to infer
# the types of instance variables based on their assigned values.


class ClassA:
    def __init__(self):
        self.value = None

    def func(self, param: int):
        reveal_type(self.value, expected_text="int | None")

        if self.value is not None:
            reveal_type(self.value, expected_text="int")
            self.value.bit_length()

        self.value = param
