# This sample tests the handling of the zero-argument form of super()
# within a comprehension when the target Python version is older than 3.12.
# Each comprehension has its own frame whose first argument is the iterator.
# Iterator types are not precise enough to establish that this receiver is
# incompatible, so a separate frame alone should not generate a diagnostic.


class ClassA:
    def method1(self):
        pass


class ClassB(ClassA):
    def method2(self):
        reveal_type([super().method1() for _ in [1]], expected_text="list[None]")

        reveal_type({super().method1() for _ in [1]}, expected_text="set[None]")

        reveal_type({0: super().method1() for _ in [1]}, expected_text="dict[int, None]")

        reveal_type(list(super().method1() for _ in [1]), expected_text="list[None]")
