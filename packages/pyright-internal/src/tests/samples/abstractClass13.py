from abstractClass13Lib import ImportedAbstractClass


# This should generate an error because the imported decorated class is abstract.
ImportedAbstractClass()
reveal_type(ImportedAbstractClass, expected_text="type[Base]")
