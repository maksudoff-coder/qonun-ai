#!/usr/bin/env bash
# D1 bazasi mavjudligini tekshiradi (bo'lmasa yaratadi) va uning ID'sini wrangler.toml'ga yozadi.
set -euo pipefail
cd "$(dirname "$0")/.."
NAME="qonun-baza"

find_id() { npx wrangler d1 list --json | jq -r --arg n "$NAME" '.[] | select(.name==$n) | .uuid' | head -1; }

ID="$(find_id)"
if [ -z "$ID" ]; then
  echo "D1 bazasi topilmadi — yaratilmoqda…"
  npx wrangler d1 create "$NAME" >/dev/null
  ID="$(find_id)"
fi
[ -n "$ID" ] || { echo "D1 ID aniqlanmadi"; exit 1; }
sed -i "s/database_id = \"[^\"]*\"/database_id = \"$ID\"/" wrangler.toml
echo "D1: $NAME ($ID)"

# Foydalanuvchilar jadvallari (mavjud bo'lsa o'zgarmaydi)
npx wrangler d1 execute "$NAME" --remote --yes --file=../d1/schema.sql >/dev/null
