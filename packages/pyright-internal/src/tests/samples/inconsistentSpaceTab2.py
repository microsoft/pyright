# This sample tests the reporting of inconsistent space/tab usage
# for dedent tokens.


if True:
	if True:
		print("False")
        print("True") # Should generate an error here.

  
