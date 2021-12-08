# This sample tests a loop that modifies a variable through type narrowing.

from typing import Literal, Union


class State:
    def confirm_dialog(self) -> Union["State", bool]:
        return False


state = State()
t0: Literal["State"] = reveal_type(state)

for _ in range(1):
    result = state.confirm_dialog()
    if isinstance(result, State):
        t1: Literal["State"] = reveal_type(state)
        t2: Literal["State"] = reveal_type(result)
        state = result
    else:
        t3: Literal["State"] = reveal_type(state)
        t4: Literal["bool"] = reveal_type(result)
