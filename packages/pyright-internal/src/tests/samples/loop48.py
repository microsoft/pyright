# This sample tests a case where an instance variable is assigned within
# a loop using its own value.

# pyright: strict


class ClassA:
    x: int | None

    def method1(self) -> None:
        self.x = 0

        for _ in range(1, 10):
            self.x = reveal_type(self.x, expected_text="int") + 1

        reveal_type(self.x, expected_text="int")

    def method2(self) -> None:
        self.x = 0

        for _ in range(1, 10):
            self.x += 1

        reveal_type(self.x, expected_text="int")
