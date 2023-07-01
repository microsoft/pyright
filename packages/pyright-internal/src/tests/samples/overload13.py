# This sample tests the case of nested overload resolution where the
# selected overload depends on bidirectional inference.

l: list[str] = []
"{s}".format(s="\n".join(sorted(l)))
