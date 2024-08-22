# This sample tests type inference for a lambda that has no inference
# context but has a default argument value.

lambda1 = lambda x="": x
reveal_type(lambda1, expected_text='(x: str = "") -> str')

lambda2 = lambda x=None: x
reveal_type(lambda2, expected_text="(x: Unknown | None = None) -> (Unknown | None)")
