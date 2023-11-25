# This sample tests type inference for empty lists and dictionaries.

# pyright: reportUnknownVariableType=true, reportUnknownArgumentType=true


def func1(a: bool):
    val1 = []

    if a:
        val1 = [2, 3]

    reveal_type(val1, expected_text="list[int]")

    if a:
        val2 = []
    else:
        val2 = []

    reveal_type(val2, expected_text="list[Unknown]")

    # This should generate an error because val2 is partially unknown.
    val2 += [3]

    val3 = val2

    # This should generate an error because val3 is partially unknown.
    print(val3)
    reveal_type(val3, expected_text="list[Unknown]")

    if a:
        val3 = [3.4]

    print(val3)
    reveal_type(val3, expected_text="list[float]")


def func2(a: bool):
    val1 = {}

    if a:
        val1 = {"a": 2}

    reveal_type(val1, expected_text="dict[str, int]")

    if a:
        val2 = {}
    else:
        val2 = {}

    reveal_type(val2, expected_text="dict[Unknown, Unknown]")

    # This should generate an error because val2 is partially unknown.
    val2.pop()

    val3 = val2

    # This should generate an error because val3 is partially unknown.
    print(val3)
    reveal_type(val3, expected_text="dict[Unknown, Unknown]")

    if a:
        val3 = {"b": 3.4}

    print(val3)
    reveal_type(val3, expected_text="dict[str, float]")


class A:
    def method1(self):
        self.val1 = []
        self.val2 = {}
        self.val3 = []

    def method2(self):
        self.val1 = [3.4]
        self.val2 = {"a": 1}

    def method3(self):
        reveal_type(self.val1, expected_text="list[float]")
        reveal_type(self.val2, expected_text="dict[str, int]")
        reveal_type(self.val3, expected_text="list[Unknown]")

    def method4(self) -> list[int]:
        # This should generate an error because of a type mismatch.
        return self.val1
