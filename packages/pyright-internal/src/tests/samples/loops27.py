# This sample tests the case where an annotated variable in a loop
# is used as an index, an implicit argument for __getitem__.

# pyright: strict


def func1(nums: list[int], target: int) -> None:
    var = nums[0]
    while True:
        mid = var
        if nums[mid] == target:
            return
        if var:
            var = mid
        else:
            var = mid
