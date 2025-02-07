# This sample tests the case where a class-scoped variable
# type needs to be inferred from an augmented assignment.


class ClassA:
    y = 0
    z = 0
    z += 0.5

    def __init__(self):
        self.x = 0
        self.x += 0.5

    @classmethod
    def method1(cls):
        cls.y += 0.5


reveal_type(ClassA().x, expected_text="int | float")
reveal_type(ClassA.y, expected_text="int | float")
reveal_type(ClassA.z, expected_text="int | float")
