class ExampleClass:
    a: int
    b: int
    c: str

    static_var = "Hello World"

    def __init__(self, a: int, b: int):
        local_c = ", world!"

        self.a = a
        self.b = b
        self.c = "hello" + local_c
