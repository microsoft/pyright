# This sample tests a piece of code that involves lots
# of cyclical dependencies for type resolution.


n: str | None = None
while True:
    if n is None:
        n = ""
    else:
        n = n + ""
