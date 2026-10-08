#!/usr/bin/env bash
# Compare les fichiers de ops/ avec ceux réellement installés sur le serveur.
# Usage, sur le serveur : bash ~/lulusia/ops/check.sh
# (les différences d'espaces et de lignes vides sont ignorées)

cd "$(dirname "$0")" || exit 1

status=0
check() {
  local repo="$1" server="$2"
  if [ ! -e "$server" ] && ! sudo test -e "$server"; then
    printf '  \033[33m?\033[0m absent du serveur : %s\n' "$server"
    status=1
  elif sudo diff -q -w -B "$repo" "$server" > /dev/null; then
    printf '  \033[32m✔\033[0m %s\n' "$server"
  else
    printf '  \033[31m✘\033[0m différent : %s  (voir : sudo diff -u %s %s)\n' "$server" "$PWD/$repo" "$server"
    status=1
  fi
}

check scripts/lulusia-backup /usr/local/bin/lulusia-backup
check scripts/lulusia-status /usr/local/bin/lulusia-status
for unit in systemd/*; do
  check "$unit" "/etc/systemd/system/$(basename "$unit")"
done
check ssh/00-hardening.conf /etc/ssh/sshd_config.d/00-hardening.conf
check monitoring/docker-compose.override.yml /home/ubuntu/satisfactory-monitoring/docker-compose.override.yml

exit "$status"
