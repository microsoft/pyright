# This sample tests assignments to indexed expressions
# where the base is a specialized object.

from typing import List, Dict, Literal, Union


v1: List[int] = [1, 2, 3, 4, 5]
# This should generate an error because
# the assigned type is wrong.
v1[0] = "a"

v2: Dict[int, str] = {1: "str"}
# This should generate an error because
# the assigned type is wrong.
v2[1] = 123

v3: List[Union[int, str]] = ["a"]
v3[0] = 3
t3: Literal["Literal[3]"] = reveal_type(v3[0])


v4: Dict[str, Union[int, str]] = {}
v4["aaa"] = 3
v4["bbb"] = "bbb"
t4_0: Literal["Literal[3]"] = reveal_type(v4["aaa"])
t4_1: Literal["Literal['bbb']"] = reveal_type(v4["bbb"])
t4_2: Literal["int | str"] = reveal_type(v4["ccc"])


class Assymetric:
    def __setitem__(self, i: int, value: object) -> None:
        ...

    def __getitem__(self, i: int) -> int:
        ...


v5 = Assymetric()
v5[0] = 3
t5: Literal["int"] = reveal_type(v5[0])
