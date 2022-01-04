## Integrating Pyright into Continuous Integration (CI)

### Running Pyright as a pre-commit hook

You can configure pyright to run as a git hook (e.g. prior to each check-in) by using the following hook definition:

```yml
-   repo: local
    hooks:
    -   id: pyright
        name: pyright
        entry: pyright
        language: node
        pass_filenames: false
        types: [python]
        # Replace the version below with the latest pyright version
        additional_dependencies: ['pyright@1.1.XXX']
```

### Running Pyright from a CI script

Alternatively, you can run pyright from a bash script. Here's a script that installs the latest version of pyright and runs it.

```bash
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
