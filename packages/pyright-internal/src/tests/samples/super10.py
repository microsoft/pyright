# This sample tests that super() calls use Self for binding.


class A:
    def clone(self):
        return self


class B(A):
    def clone(self):
        return super().clone()


class C(B):
    def clone(self):
        return super().clone()


reveal_type(A().clone(), expected_text="A")
reveal_type(B().clone(), expected_text="B")
reveal_type(C().clone(), expected_text="C")
