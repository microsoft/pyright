## Getting Started with Type Checking

A static type checker like Pyright can add incremental value to your source code as more type information is provided.

Here is a typical progression:
1. Install pyright (either the VS Code extension or command-line tool).
2. Write a minimal `pyrightconfig.json` that defines `include` entries. Place the config file in your project’s top-level directory and commit it to your repo.
3. Optionally enable the `python.analysis.useLibraryCodeForTypes` config option (or pass `--libs` to the command-line tool). This tells Pyright that it should attempt to infer type information from library code if a type stub is not available.
4. Run pyright over your source base with the default settings. Fix any errors and warnings that it emits.
5. Enable the `reportMissingTypeStubs` setting in the config file and add (minimal) type stub files for the imported files. You may wish to create a stubs directory within your code base — a location for all of your custom type stub files. Configure the “stubPath” config entry to refer to this directory.
6. Look for type stubs for the packages you use. Some package authors opt to ship stubs as a separate companion package named that has “-stubs” appended to the name of the original package.
7. In cases where type stubs do not yet exist for a package you are using, consider creating a custom type stub that defines the portion of the interface that your source code consumes. Check in your custom type stub files and configure pyright to run as part of your continuous integration (CI) environment to keep the project “type clean”.
8. Incrementally add type annotations to your code files. The annotations that provide most value are on function input parameters, instance variables, and return parameters (in that order). Note that annotation of variables (instance, class and local) requires Python 3.6 or newer.
9. Enable stricter type checking options like "reportOptionalSubscript", "reportOptionalMemberAccess", "reportOptionalCall", and "reportUntypedFunctionDecorator".
10. On a file-by-file basis, enable all type checking options by adding the comment `# pyright: strict` somewhere in the file.
11. Optionally add entire subdirectories to the `strict` config entry to indicate that all files within those subdirectories should be strictly typed.


### Running Pyright as part of Continuous Integration (CI)

Here is a simple bash script that installs the latest version of Pyright and runs it on a code base. It can be used in a CI environment.

```
#!/bin/bash
PATH_TO_PYRIGHT=`which pyright`

vercomp () {
    if [[ $1 == $2 ]]
    then
        return 0
    fi
    local IFS=.
    local i ver1=($1) ver2=($2)
    # fill empty fields in ver1 with zeros
    for ((i=${#ver1[@]}; i<${#ver2[@]}; i++))
    do
        ver1[i]=0
    done
    for ((i=0; i<${#ver1[@]}; i++))
    do
        if [[ -z ${ver2[i]} ]]
        then
            # fill empty fields in ver2 with zeros
            ver2[i]=0
        fi
        if ((10#${ver1[i]} > 10#${ver2[i]}))
        then
            return 1
        fi
        if ((10#${ver1[i]} < 10#${ver2[i]}))
        then
            return 2
        fi
    done
    return 0
}

# Node version check
echo "Checking node version..."
NODE_VERSION=`node -v | cut -d'v' -f2`
MIN_NODE_VERSION="10.15.2"
vercomp $MIN_NODE_VERSION $NODE_VERSION
# 1 == gt
if [[ $? -eq 1 ]]; then
    echo "Node version ${NODE_VERSION} too old, min expected is ${MIN_NODE_VERSION}, run:"
    echo " npm -g upgrade node"
    exit -1
fi

# Do we need to sudo?
echo "Checking node_modules dir..."
NODE_MODULES=`npm -g root`
SUDO="sudo"
if [ -w "$NODE_MODULES" ]; then
    SUDO="" #nop
fi

# If we can't find pyright, install it.
echo "Checking pyright exists..."
if [ -z "$PATH_TO_PYRIGHT" ]; then
    echo "...installing pyright"
    ${SUDO} npm install -g pyright
else
    # already installed, upgrade to make sure it's current
    # this avoids a sudo on launch if we're already current
    echo "Checking pyright version..."
    CURRENT=`pyright --version | cut -d' ' -f2`
    REMOTE=`npm info pyright version`
    if [ "$CURRENT" != "$REMOTE" ]; then
        echo "...new version of pyright found, upgrading."
        ${SUDO} npm upgrade -g pyright
    fi
fi

echo "done."
pyright -w
```
