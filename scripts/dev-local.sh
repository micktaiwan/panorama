#!/bin/bash
# Lance le backend local connecté à la DB du serveur de prod
# Nécessite un tunnel SSH actif : ssh -f -N -L 27018:172.18.0.4:27017 ubuntu@51.210.150.25
# (L'IP 172.18.0.4 est celle du container organizer-mongodb)

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/../backend"

# Vérifier que le tunnel est actif
if ! nc -z 127.0.0.1 27018 2>/dev/null; then
  echo "Tunnel SSH non actif. Lancement..."

  # Trouver le socket SSH agent
  if [ -z "$SSH_AUTH_SOCK" ]; then
    SOCK=$(find /tmp/ssh-* -name "agent.*" 2>/dev/null | head -1)
    if [ -n "$SOCK" ]; then
      export SSH_AUTH_SOCK="$SOCK"
    else
      echo "ERREUR: Pas de SSH agent. Lance: eval \"\$(ssh-agent -s)\" && ssh-add ~/.ssh/id_ed25519"
      exit 1
    fi
  fi

  ssh -f -N -L 27018:172.18.0.4:27017 ubuntu@51.210.150.25
  echo "Tunnel SSH ouvert sur le port 27018"
fi

echo "=== Backend local (DB distante) ==="
echo "MongoDB: 127.0.0.1:27018/panoramix (via tunnel SSH)"
echo "API: http://localhost:3002"
echo ""

cd "$BACKEND_DIR"
MONGODB_URI=mongodb://127.0.0.1:27018/panoramix exec npm run dev
