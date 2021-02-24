def getopt(args: list[str], shortopts: str, longopts: list[str] = ...) -> tuple[list[tuple[str, str]], list[str]]: ...
def gnu_getopt(args: list[str], shortopts: str, longopts: list[str] = ...) -> tuple[list[tuple[str, str]], list[str]]: ...

class GetoptError(Exception):
    msg: str
    opt: str

error = GetoptError
