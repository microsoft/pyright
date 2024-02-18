# This sample tests assignments to indexed expressions
# where the base is a specialized object.

# Enable the reportUnknownArgumentType check so we can verify that it
# doesn't generate an error when assigning an empty list to an indexed
# expression.
# pyright: reportUnknownArgumentType=true


v1: list[int] = [1, 2, 3, 4, 5]
# This should generate an error because the assigned type is wrong.
v1[0] = "a"

v2: dict[int, str] = {1: "str"}
# This should generate an error because the assigned type is wrong.
v2[1] = 123

v3: list[int | str] = ["a"]
v3[0] = 3
reveal_type(v3[0], expected_text="Literal[3]")


v4: dict[str, int | str] = {}
v4["aaa"] = 3
v4["bbb"] = "bbb"
reveal_type(v4["aaa"], expected_text="Literal[3]")
reveal_type(v4["bbb"], expected_text="Literal['bbb']")
reveal_type(v4["ccc"], expected_text="int | str")


class Asymmetric:
    def __setitem__(self, i: int, value: object) -> None: ...

    def __getitem__(self, i: int) -> int: ...


v5 = Asymmetric()
v5[0] = 3
reveal_type(v5[0], expected_text="int")


v6 = [1, 2, 3]
v6[1:] = []
