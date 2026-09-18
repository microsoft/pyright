t1: tuple[int, ...] = (1, 2, 3)
t2: tuple[int, ...] = (1, 2, 4)

reveal_type(t1, expected_text="tuple[int, ...]")
reveal_type(t2, expected_text="tuple[int, ...]")

_ = t1 >= t2
