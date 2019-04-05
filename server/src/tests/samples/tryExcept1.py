# This sample tests the semantic analyzer's handling of
# try/except/raise statements


def func1():
    
    try:
        pass
    except:
        raise
    
    # This should generate an error because it's
    # a "naked" raise statement.
    raise



