#!/bin/bash
# Convert a HuggingFace NLLB model to CTranslate2 format.
#
# Usage:
#   ./convert-ct2-model.sh <model_id> <quantization> [output_dir]
#
# Examples:
#   ./convert-ct2-model.sh facebook/nllb-200-distilled-600M int8_float16
#   ./convert-ct2-model.sh facebook/nllb-200-3.3B float16 /data/ct2-models
#
# The script also copies the sentencepiece.bpe.model file to the output
# directory so the runtime server can find it.

set -euo pipefail

MODEL_ID="${1:?Usage: $0 <model_id> <quantization> [output_dir]}"
QUANTIZATION="${2:?Usage: $0 <model_id> <quantization> [output_dir]}"
OUTPUT_BASE="${3:-/data/ct2-models}"

SAFE_NAME="${MODEL_ID//\//-\-}"
OUTPUT_DIR="${OUTPUT_BASE}/${SAFE_NAME}-${QUANTIZATION}"

if [ -f "${OUTPUT_DIR}/model.bin" ]; then
    echo "CT2 model already exists at ${OUTPUT_DIR}, skipping conversion."
    exit 0
fi

echo "Converting ${MODEL_ID} to CT2 (${QUANTIZATION})..."
echo "  Output: ${OUTPUT_DIR}"

ct2-transformers-converter \
    --model "${MODEL_ID}" \
    --quantization "${QUANTIZATION}" \
    --output_dir "${OUTPUT_DIR}" \
    --force

# Copy sentencepiece model to output dir for easy discovery
python3 -c "
from huggingface_hub import hf_hub_download
import shutil, os
sp = hf_hub_download('${MODEL_ID}', 'sentencepiece.bpe.model')
dst = os.path.join('${OUTPUT_DIR}', 'sentencepiece.bpe.model')
if not os.path.exists(dst):
    shutil.copy2(sp, dst)
    print(f'Copied sentencepiece model to {dst}')
else:
    print(f'sentencepiece model already at {dst}')
"

echo "Conversion complete: ${OUTPUT_DIR}"
ls -lh "${OUTPUT_DIR}/"
