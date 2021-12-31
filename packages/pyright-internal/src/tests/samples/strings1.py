# This sample tests the reportImplicitStringConcatenation diagnostic check.


def func1(val: str):
    pass


func1("first argument" "second argument")

func1(
    "This is the first argument, which contains "
    "especially long text that could not fit into "
    "one single line thus should be spread."
)

func1(
    (
        "This is the first argument, which contains "
        "especially long text that could not fit into "
        "one single line thus should be spread."
    )
)
