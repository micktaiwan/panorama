#!/usr/bin/env bash
set -euo pipefail

source ~/.env.secrets
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
cd "$(dirname "$0")/.deploy"
nvm exec 20.9.0 mup deploy
