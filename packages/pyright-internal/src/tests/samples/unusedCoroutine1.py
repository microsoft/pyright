# This sample tests the reportUnusedCoroutine diagnostic rule.


async def func1():
    return 3


async def func2() -> str:
    return "5"


async def func3():
    await func1()
    await func2()

    # This should generate an error
    func1()

    # This should generate an error
    func2()

    _ = func1()
    _ = func2()
