"""
NLLB-200 Translation Server

FastAPI server wrapping HuggingFace's NLLB-200 distilled model.
Endpoints:
  POST /translate  { text, source_lang, target_lang } → { translation }
  GET  /health     → { status: "ok", model: "..." }

Environment variables:
  MODEL_NAME  - HuggingFace model ID (default: facebook/nllb-200-distilled-600M)
  HOST        - Bind address (default: 0.0.0.0)
  PORT        - Port (default: 8000)
"""

import os
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uvicorn

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

MODEL_NAME = os.environ.get("MODEL_NAME", "facebook/nllb-200-distilled-600M")

# Lazy-loaded globals
tokenizer = None
model = None


def load_model():
    """Load model and tokenizer (called once at startup)."""
    global tokenizer, model
    from transformers import AutoTokenizer, AutoModelForSeq2SeqLM

    logger.info(f"Loading model: {MODEL_NAME}")
    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
    model = AutoModelForSeq2SeqLM.from_pretrained(MODEL_NAME)
    logger.info("Model loaded successfully")


@asynccontextmanager
async def lifespan(app: FastAPI):
    load_model()
    yield


app = FastAPI(title="NLLB Translation Server", lifespan=lifespan)


class TranslateRequest(BaseModel):
    text: str
    source_lang: str
    target_lang: str


class TranslateResponse(BaseModel):
    translation: str


@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL_NAME}


@app.post("/translate", response_model=TranslateResponse)
def translate(req: TranslateRequest):
    if tokenizer is None or model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    try:
        tokenizer.src_lang = req.source_lang
        inputs = tokenizer(req.text, return_tensors="pt", truncation=True, max_length=512)
        target_lang_id = tokenizer.convert_tokens_to_ids(req.target_lang)

        generated = model.generate(
            **inputs,
            forced_bos_token_id=target_lang_id,
            max_new_tokens=256,
        )

        result = tokenizer.batch_decode(generated, skip_special_tokens=True)[0]
        return TranslateResponse(translation=result)

    except Exception as e:
        logger.error(f"Translation error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run(app, host=host, port=port)
