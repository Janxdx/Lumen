#!/usr/bin/env bash
#
# Move the Cloudflare resources from the old name to the new one.
#
# The code rename (Lumen → Soluna) is already committed; what is left is the
# two things that live in your Cloudflare account rather than in this repo:
# the D1 database and the R2 bucket. Neither can be renamed in place, so this
# creates the new ones and copies the contents across.
#
# Nothing here deletes anything. The old database and bucket are untouched
# and remain a complete backup until you remove them by hand — which is the
# point, and why this script is safe to run twice.
#
#   ./scripts/rename-to-soluna.sh
#
# Needs: wrangler logged in (`npx wrangler login`) and jq.

set -euo pipefail

OLD_DB="lumen"
NEW_DB="soluna"
OLD_BUCKET="lumen-books"
NEW_BUCKET="soluna-books"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

command -v jq >/dev/null || { echo "jq is required — brew install jq"; exit 1; }

# ── 1. the new database ──────────────────────────────────────────────
#
# `d1 create` fails if the database already exists, which is what makes
# re-running this safe: we fall back to looking the id up instead.

say "1/5  Creating D1 database '$NEW_DB'"
if npx wrangler d1 create "$NEW_DB" >"$WORK/create.txt" 2>&1; then
  cat "$WORK/create.txt"
else
  grep -qi "already exists" "$WORK/create.txt" || { cat "$WORK/create.txt"; exit 1; }
  echo "  already exists — reusing it"
fi

DB_ID="$(npx wrangler d1 list --json | jq -r --arg n "$NEW_DB" '.[] | select(.name == $n) | .uuid')"
[ -n "$DB_ID" ] || { echo "Could not find the id of '$NEW_DB'."; exit 1; }
echo "  database_id: $DB_ID"

# ── 2. the rows ──────────────────────────────────────────────────────
#
# A full export, schema included, replayed into the new database. The dump
# is left in the repo root on purpose: it is a point-in-time backup of
# everything you have ever read, and it costs nothing to keep.

say "2/5  Exporting '$OLD_DB' and importing into '$NEW_DB'"
DUMP="lumen-backup-$(date +%Y%m%d-%H%M%S).sql"
npx wrangler d1 export "$OLD_DB" --remote --output "$DUMP"
echo "  wrote $DUMP ($(wc -c <"$DUMP" | tr -d ' ') bytes)"
npx wrangler d1 execute "$NEW_DB" --remote --file "$DUMP" --yes

# ── 3. the new bucket ────────────────────────────────────────────────

say "3/5  Creating R2 bucket '$NEW_BUCKET'"
npx wrangler r2 bucket create "$NEW_BUCKET" 2>&1 | tee "$WORK/bucket.txt" || \
  grep -qi "already exists" "$WORK/bucket.txt"

# ── 4. the files ─────────────────────────────────────────────────────
#
# The object keys are not guessed and the bucket is never listed: D1 already
# holds every key in books.file_path and books.cover_path, written there by
# the Worker when it stored the object. Reading the list from the database
# means we copy exactly the objects the app will ask for, and nothing else.

say "4/5  Copying objects from '$OLD_BUCKET' to '$NEW_BUCKET'"
npx wrangler d1 execute "$OLD_DB" --remote --json --command \
  "select file_path as k from books where file_path is not null and deleted = 0
   union
   select cover_path as k from books where cover_path is not null and deleted = 0" \
  | jq -r '.[0].results[].k' >"$WORK/keys.txt"

TOTAL=$(wc -l <"$WORK/keys.txt" | tr -d ' ')
echo "  $TOTAL objects to copy"

N=0
while IFS= read -r KEY; do
  [ -n "$KEY" ] || continue
  N=$((N + 1))
  printf '  [%d/%d] %s\n' "$N" "$TOTAL" "$KEY"

  case "$KEY" in
    *.epub) CT="application/epub+zip" ;;
    *)      CT="application/octet-stream" ;;
  esac

  npx wrangler r2 object get "$OLD_BUCKET/$KEY" --remote --file "$WORK/obj" >/dev/null
  npx wrangler r2 object put "$NEW_BUCKET/$KEY" --remote --file "$WORK/obj" \
    --content-type "$CT" >/dev/null
  rm -f "$WORK/obj"
done <"$WORK/keys.txt"

# ── 5. what you do next ──────────────────────────────────────────────

say "5/5  Done — one line left to change by hand"
cat <<EOF

In wrangler.jsonc, replace the placeholder with the real id:

    "database_id": "$DB_ID"

Then:

    npm run deploy

The old '$OLD_DB' database and '$OLD_BUCKET' bucket still hold everything.
Delete them only once the new deployment has been signing in, syncing and
opening books for a few days.

EOF
