# This sample tests a loop that modifies a variable through type narrowing.


class State:
    def confirm_dialog(self) -> "State | bool":
        return False


state = State()
reveal_type(state, expected_text="State")

for _ in range(1):
    result = state.confirm_dialog()
    if isinstance(result, State):
        reveal_type(state, expected_text="State")
        reveal_type(result, expected_text="State")
        state = result
    else:
        reveal_type(state, expected_text="State")
        reveal_type(result, expected_text="bool")
