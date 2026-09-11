# Sample test for tuple slicing with start index >= stop index.

t: tuple[int, str, bool] = (1, "a", True)

# Slicing where start >= stop produces an empty tuple (tuple[()])
# in Python runtime.

a = t[2:1]
reveal_type(a, expected_text="tuple[()]")

b = t[-1:-2]
reveal_type(b, expected_text="tuple[()]")

c = t[5:1]
reveal_type(c, expected_text="tuple[()]")
