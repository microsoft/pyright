class FakeOs:
    name: str = "nt"


def func(os: FakeOs) -> None:
    if os.name == "nt":
        reveal_type(os)
        reveal_type(os, expected_text="FakeOs")
