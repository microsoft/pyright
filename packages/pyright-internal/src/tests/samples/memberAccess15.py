# This sample tests the case where an accessed member is a
# method that has a "self" or "cls" parameter with no explicit
# type annotation and an inferred type that is based on this value.


class A:
    async def get(self):
        return self


class B(A):
    pass


async def run():
    val1 = await A().get()
    reveal_type(val1, expected_text="A")

    val2 = await B().get()
    reveal_type(val2, expected_text="B")
