#!/usr/bin/env bash
set -euo pipefail

# Cloudflare ships workerd as a generic glibc-linked binary. NixOS uses a stub
# ELF interpreter, so launch workerd explicitly through the glibc supplied by
# this script's nix shell. Miniflare supports an executable override for this.
workerd_path="$(node -p "require('workerd').default")"
ldd_path="$(command -v ldd)"
loader="$(sed -n 's/^RTLDLIST="\([^ ]*\).*/\1/p' "$ldd_path")"

if [[ -z "$loader" || ! -x "$loader" ]]; then
  echo "Could not locate the Nix glibc loader." >&2
  exit 1
fi

glibc_root="${loader%/lib64/*}"
wrapper="$(mktemp -t findspot-workerd.XXXXXX)"
trap 'rm -f "$wrapper"' EXIT

printf '#!/usr/bin/env bash\nexec %q --library-path %q %q "$@"\n' \
  "$loader" "$glibc_root/lib" "$workerd_path" > "$wrapper"
chmod +x "$wrapper"

MINIFLARE_WORKERD_PATH="$wrapper" npm run test:worker
