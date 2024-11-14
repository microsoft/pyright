# This sample tests the syntax handling for Python 3.11 exception groups
# as described in PEP 654.


def func1():

    try:
        pass

    # This should generate an error if using Python 3.10 or earlier.
    except* ValueError as e:
        reveal_type(e, expected_text="ExceptionGroup[ValueError]")
        pass

    # This should generate an error if using Python 3.10 or earlier.
    except*:
        pass


def func2():
    try:
        pass
    # This should generate an error because ExceptionGroup derives
    # from BaseExceptionGroup.
    except* ExceptionGroup as e:
        pass

    # This should generate an error because ExceptionGroup derives
    # from BaseExceptionGroup.
    except* (ValueError, ExceptionGroup) as e:
        pass

def func3():
    try:
        pass

    except* ValueError:
        pass
    
    # This should generate an error because except and except* cannot be mixed.
    except NameError:
        pass

    except* ValueError:
        pass
        
def func4():
    try:
        pass

    except ValueError:
        pass
    
    except NameError:
        pass

    # This should generate an error because except and except* cannot be mixed.
    except* ValueError:
        pass
        

def func5():
    try:
        pass

    except* ValueError:
        pass
    
    # This should generate an error because except and except* cannot be mixed.
    except:
        pass
    
def func6():
    try:
        pass

    # This should generate an error because except* requires an exception type.
    except*:
        pass


def func7():
    while True:
        try:
            ...
        except* ValueError:
            def inner():
                while True:
                    if 1 < 1:
                        continue
                    else:
                        break
                return

            if 1 < 2:
                # This should generate an error because
                # break is not allowed in an except* block.
                break
            if 1 < 2:
                # This should generate an error because
                # continue is not allowed in an except* block.
                continue

            # This should generate an error because
            # return is not allowed in an except* block.
            return



def func8():

    try:
        pass

    # This should generate an error if using Python 3.10 or earlier.
    except* (ValueError, FloatingPointError) as e:
        reveal_type(e, expected_text="ExceptionGroup[ValueError | FloatingPointError]")
        pass

    # This should generate an error if using Python 3.10 or earlier.
    except* BaseException as e:
        reveal_type(e, expected_text="BaseExceptionGroup[BaseException]")
        pass
