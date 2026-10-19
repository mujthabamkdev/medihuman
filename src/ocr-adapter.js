let tesseractPromise;
const TESSERACT_MODULE_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/+esm';

async function loadTesseract() {
  if (!tesseractPromise) {
    tesseractPromise = import(TESSERACT_MODULE_URL).catch(() => null);
  }
  return tesseractPromise;
}

/**
 * Best-effort OCR adapter. Printed text often works; cursive or unusual
 * handwriting can be wrong. Every result must pass through the review screen.
 * A deployment can replace this seam with a contracted, audited OCR provider.
 */
export function createOcrAdapter(provider = null) {
  if (provider && typeof provider.recognize === 'function') return provider;
  return {
    name: 'Tesseract.js best effort',
    available: false,
    async recognize(source) {
      const tesseract = await loadTesseract();
       if (!tesseract?.createWorker) return { text: '', confidence: null, provider: 'manual fallback', error: 'OCR engine unavailable; manual entry required.' };
      const worker = await tesseract.createWorker('eng');
      try {
        const result = await worker.recognize(source);
        return { text: result.data.text || '', confidence: result.data.confidence ?? null, provider: 'Tesseract.js' };
      } finally {
        await worker.terminate();
      }
    },
  };
}
