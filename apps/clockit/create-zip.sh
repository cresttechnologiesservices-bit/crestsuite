#!/bin/bash
# ClockIT Monorepo - Package Script

set -e

PROJECT_NAME="clockit-monorepo"
ZIP_NAME="${PROJECT_NAME}-$(date +%Y%m%d).zip"

echo "📦 Creating ${ZIP_NAME}..."

# Create temporary directory
TEMP_DIR="$(mktemp -d)"
PACKAGE_DIR="${TEMP_DIR}/${PROJECT_NAME}"
mkdir -p "${PACKAGE_DIR}"

# Copy all project files (excluding build artifacts)
rsync -av \
  --exclude='node_modules' \
  --exclude='dist' \
  --exclude='.git' \
  --exclude='*.log' \
  --exclude='.env' \
  --exclude='.DS_Store' \
  --exclude='coverage' \
  --exclude='.prisma' \
  --exclude='create-zip.sh' \
  --exclude='*.zip' \
  ./ "${PACKAGE_DIR}/"

# Create zip
cd "${TEMP_DIR}"
zip -r "${OLDPWD}/${ZIP_NAME}" "${PROJECT_NAME}" > /dev/null
cd "${OLDPWD}"

# Cleanup
rm -rf "${TEMP_DIR}"

echo "✅ Successfully created: ${ZIP_NAME}"
echo "📊 Size: $(du -h "${ZIP_NAME}" | cut -f1)"
echo ""
echo "To extract and run:"
echo "  unzip ${ZIP_NAME}"
echo "  cd ${PROJECT_NAME}"
echo "  cp .env.example .env"
echo "  npm install"
echo "  docker compose up -d"
echo "  npm run db:migrate"
echo "  npm run db:seed"
echo "  npm run dev"
