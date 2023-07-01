# This sample tests the case where a loop uses tuple assignments. It verifies
# that no "unknown" values are evaluated for variables assigned in the loop.

# pyright: strict

nums: list[int] = [1, 2, 3]
max_product, min_product = nums[0], nums[0]

for x in nums[1:]:
    candidates = max_product * x, min_product * x
    min_product = min(candidates)
    max_product = max(candidates)
    reveal_type(candidates, expected_text="tuple[int, int]")
