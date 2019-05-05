# This sample tests function parameter matching logic.

def func1(a: int, *b: int):
    pass

func1(3)
func1(3, 4)
func1(3, *[1, 2, 3])

# This should generate an error
func1(3, 'hello')

# This should generate an error
func1(3, 5, 2, 'str')

# This should generate an error
func1('hello', 3)

# This should generate an error
str_list = ['he', '2', '3']
func1(3, *str_list)


def func2(a: str, **b: int):
    pass


func2('hi')
func2('hi', b=3, c=4, d=5)

str_dict = {'a': '3', 'b': '2'}
func2('hi', **str_dict)


# This should generate a type error
func2('hi', 3)

# This should generate a type error
func2('hi', b='hi')


