# This sample tests operator overloads for matrix multiply operations.


class A:
    pass


class B:
    def __rmul__(self, a: A):
        pass

    def __rmatmul__(self, a: A):
        pass

    def __matmul__(self, a: A):
        pass


a, b = A(), B()

a @ b
b @ a
