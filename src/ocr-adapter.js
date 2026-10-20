/**
 * Client-side prescription reading.
 *
 * Images never leave the browser. The pipeline improves a photo before
 * reading it (upscale, contrast stretch, deskew, local threshold), measures
 * whether the photo is good enough to read, then runs two page-segmentation
 * passes and keeps the more confident result. Handwriting is never trusted:
 * every reading is marked for human review.
 *
 * A deployment can replace this seam with a contracted, audited OCR provider
 * by passing a provider with a `recognize` method.
 */

let workerPromise;
let sharedWorker = null;
let recognitionQueue = Promise.resolve();

const TESSERACT_MODULE_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/+esm';
const MIN_READ_HEIGHT = 1200;
const MAX_READ_WIDTH = 2400;

const QUALITY = {
  minEdge: 700,
  blurVariance: 90,
  glareRatio: 0.12,
  paperLevel: 246,
  darkMean: 48,
  contrastStdDev: 20,
  maxSkew: 3.5,
};

async function loadTesseract() {
  if (!workerPromise) {
    workerPromise = import(TESSERACT_MODULE_URL).catch(() => null);
  }
  return workerPromise;
}

async function getWorker() {
  if (sharedWorker) return sharedWorker;
  if (!workerPromise) {
    workerPromise = (async () => {
      const tesseract = await loadTesseract();
      if (!tesseract?.createWorker) return null;
      const worker = await tesseract.createWorker('eng', 1, { logger: () => undefined });
      sharedWorker = worker;
      return worker;
    })();
  }
  return workerPromise;
}

async function disposeWorker() {
  const worker = sharedWorker;
  sharedWorker = null;
  workerPromise = null;
  await worker?.terminate?.();
}

function toCanvas(source) {
  if (typeof document === 'undefined') return null;
  if (source?.nodeName === 'CANVAS') return source;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  if (source instanceof HTMLVideoElement) {
    canvas.width = source.videoWidth;
    canvas.height = source.videoHeight;
    context.drawImage(source, 0, 0);
    return canvas;
  }
  if (source instanceof HTMLImageElement || source instanceof ImageBitmap) {
    canvas.width = source.naturalWidth || source.width;
    canvas.height = source.naturalHeight || source.height;
    context.drawImage(source, 0, 0);
    return canvas;
  }
  return null;
}

async function toCanvasFromBlob(source) {
  if (typeof document === 'undefined' || !(source instanceof Blob)) return null;
  const bitmap = await createImageBitmap(source);
  const canvas = toCanvas(bitmap);
  bitmap.close?.();
  return canvas;
}

function grayscaleData(imageData) {
  const { data } = imageData;
  for (let index = 0; index < data.length; index += 4) {
    const luminance = 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];
    data[index] = luminance;
    data[index + 1] = luminance;
    data[index + 2] = luminance;
  }
  return imageData;
}

function histogramPercentiles(imageData, low = 0.02, high = 0.98) {
  const histogram = new Uint32Array(256);
  const { data } = imageData;
  const pixels = data.length / 4;
  for (let index = 0; index < data.length; index += 4) histogram[Math.round(data[index])] += 1;
  const lowTarget = pixels * low;
  const highTarget = pixels * high;
  let running = 0;
  let lowValue = 0;
  let highValue = 255;
  for (let value = 0; value < 256; value += 1) {
    running += histogram[value];
    if (running >= lowTarget) { lowValue = value; break; }
  }
  running = 0;
  for (let value = 0; value < 256; value += 1) {
    running += histogram[value];
    if (running >= highTarget) { highValue = value; break; }
  }
  if (highValue <= lowValue) return { low: 0, high: 255 };
  return { low: lowValue, high: highValue };
}

function stretchContrast(imageData) {
  const { low, high } = histogramPercentiles(imageData);
  const range = Math.max(high - low, 1);
  const { data } = imageData;
  for (let index = 0; index < data.length; index += 4) {
    const value = Math.max(0, Math.min(255, ((data[index] - low) / range) * 255));
    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
  }
  return imageData;
}

function thresholdData(imageData, offset = 10, windowSize = 25) {
  const { data, width, height } = imageData;
  const integral = new Float64Array((width + 1) * (height + 1));
  for (let row = 0; row < height; row += 1) {
    let rowSum = 0;
    for (let column = 0; column < width; column += 1) {
      const pixel = data[(row * width + column) * 4];
      rowSum += pixel;
      integral[(row + 1) * (width + 1) + column + 1] = integral[row * (width + 1) + column + 1] + rowSum;
    }
  }
  const half = Math.max(1, Math.floor(windowSize / 2));
  for (let row = 0; row < height; row += 1) {
    const top = Math.max(0, row - half);
    const bottom = Math.min(height, row + half + 1);
    for (let column = 0; column < width; column += 1) {
      const left = Math.max(0, column - half);
      const right = Math.min(width, column + half + 1);
      const area = (bottom - top) * (right - left);
      const sum = integral[bottom * (width + 1) + right] - integral[top * (width + 1) + right]
        - integral[bottom * (width + 1) + left] + integral[top * (width + 1) + left];
      const mean = sum / area;
      const pixelIndex = (row * width + column) * 4;
      const value = data[pixelIndex] < mean - offset ? 0 : 255;
      data[pixelIndex] = value;
      data[pixelIndex + 1] = value;
      data[pixelIndex + 2] = value;
    }
  }
  return imageData;
}

function measureSkew(canvas) {
  if (typeof document === 'undefined') return 0;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return 0;
  const scale = Math.min(1, 320 / canvas.width);
  const width = Math.max(1, Math.round(canvas.width * scale));
  const height = Math.max(1, Math.round(canvas.height * scale));
  const probe = document.createElement('canvas');
  probe.width = width;
  probe.height = height;
  const probeContext = probe.getContext('2d', { willReadFrequently: true });
  if (!probeContext) return 0;
  probeContext.drawImage(canvas, 0, 0, width, height);
  const image = grayscaleData(probeContext.getImageData(0, 0, width, height));
  thresholdData(image, 12, 15);
  const source = image.data;
  let bestAngle = 0;
  let bestScore = -1;
  for (let angle = -8; angle <= 8; angle += 1) {
    const radians = (angle * Math.PI) / 180;
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    const rowSums = new Float64Array(height * 2);
    for (let row = 0; row < height; row += 1) {
      for (let column = 0; column < width; column += 1) {
        const rotatedRow = Math.round(row * cosine - column * sine) + height;
        if (rotatedRow < 0 || rotatedRow >= rowSums.length) continue;
        if (source[(row * width + column) * 4] < 128) rowSums[rotatedRow] += 1;
      }
    }
    let score = 0;
    for (let row = 1; row < rowSums.length; row += 1) {
      const difference = rowSums[row] - rowSums[row - 1];
      score += difference * difference;
    }
    if (score > bestScore) { bestScore = score; bestAngle = angle; }
  }
  return bestAngle;
}

function rotate(canvas, angle) {
  if (!angle || typeof document === 'undefined') return canvas;
  const rotated = document.createElement('canvas');
  rotated.width = canvas.width;
  rotated.height = canvas.height;
  const context = rotated.getContext('2d', { willReadFrequently: true });
  if (!context) return canvas;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, rotated.width, rotated.height);
  context.translate(rotated.width / 2, rotated.height / 2);
  context.rotate((angle * Math.PI) / 180);
  context.drawImage(canvas, -rotated.width / 2, -rotated.height / 2);
  return rotated;
}

function measureQuality(canvas) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return { metrics: {}, issues: [] };
  const width = canvas.width;
  const height = canvas.height;
  const image = grayscaleData(context.getImageData(0, 0, width, height));
  const { data } = image;
  let sum = 0;
  let sumSquares = 0;
  let bright = 0;
  let dark = 0;
  const pixels = width * height;
  for (let index = 0; index < data.length; index += 4) {
    const value = data[index];
    sum += value;
    sumSquares += value * value;
    if (value > 250) bright += 1;
    if (value < 18) dark += 1;
  }
  const mean = sum / pixels;
  const stdDev = Math.sqrt(Math.max(sumSquares / pixels - mean * mean, 0));
  const { high: paperLevel } = histogramPercentiles(image, 0.5, 0.98);
  return {
    metrics: {
      width,
      height,
      mean,
      stdDev,
      paperLevel,
      blurVariance: 0,
      glareRatio: bright / pixels,
      darkRatio: dark / pixels,
    },
    issues: [],
  };
}

/** Sharpness estimate: variance of the Laplacian on a greyscale copy. */
function measureBlur(canvas) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return 0;
  const width = canvas.width;
  const height = canvas.height;
  const image = grayscaleData(context.getImageData(0, 0, width, height));
  const { data } = image;
  let laplacianSum = 0;
  let laplacianSquares = 0;
  let samples = 0;
  for (let row = 1; row < height - 1; row += 3) {
    for (let column = 1; column < width - 1; column += 3) {
      const centre = data[(row * width + column) * 4];
      const laplacian = 4 * centre
        - data[(row * width + column - 1) * 4]
        - data[(row * width + column + 1) * 4]
        - data[((row - 1) * width + column) * 4]
        - data[((row + 1) * width + column) * 4];
      laplacianSum += laplacian;
      laplacianSquares += laplacian * laplacian;
      samples += 1;
    }
  }
  return samples ? Math.max(laplacianSquares / samples - (laplacianSum / samples) ** 2, 0) : 0;
}

function grayscaleCopy(canvas) {
  if (typeof document === 'undefined') return canvas;
  const copy = document.createElement('canvas');
  copy.width = canvas.width;
  copy.height = canvas.height;
  const context = copy.getContext('2d', { willReadFrequently: true });
  if (!context) return canvas;
  context.drawImage(canvas, 0, 0);
  const image = context.getImageData(0, 0, copy.width, copy.height);
  grayscaleData(image);
  context.putImageData(image, 0, 0);
  return copy;
}

/** Map capture measurements to plain guidance for the person taking the photo. */
export function qualityIssues(metrics) {
  const issues = [];
  if (!metrics || !metrics.width) return issues;
  if (Math.min(metrics.width, metrics.height) < QUALITY.minEdge) {
    issues.push({ code: 'low-resolution', title: 'Too far away', detail: 'Move closer so the writing fills the frame. Small handwriting needs a larger photo.' });
  }
  if (metrics.blurVariance < QUALITY.blurVariance) {
    issues.push({ code: 'blurry', title: 'Soft or shaky', detail: 'Hold the phone steady, tap the page to focus, and take the photo again.' });
  }
  if (metrics.glareRatio > QUALITY.glareRatio && metrics.paperLevel < QUALITY.paperLevel) {
    issues.push({ code: 'glare', title: 'Glare or reflection', detail: 'Turn the page away from direct light or move to softer lighting.' });
  }
  if (metrics.mean < QUALITY.darkMean) {
    issues.push({ code: 'too-dark', title: 'Too dark', detail: 'Add light from the side so the writing is clearly lit.' });
  }
  if (metrics.stdDev < QUALITY.contrastStdDev) {
    issues.push({ code: 'low-contrast', title: 'Low contrast', detail: 'Avoid shadows across the page and use a plain, light background.' });
  }
  return issues;
}

function enhance(canvas) {
  if (!canvas || typeof document === 'undefined') return { canvas, qualityCanvas: canvas, skew: 0 };
  const scale = Math.min(MAX_READ_WIDTH / canvas.width, Math.max(MIN_READ_HEIGHT / canvas.height, 1), 2.5);
  let working = canvas;
  if (scale > 1.01) {
    const scaled = document.createElement('canvas');
    scaled.width = Math.round(canvas.width * scale);
    scaled.height = Math.round(canvas.height * scale);
    const context = scaled.getContext('2d', { willReadFrequently: true });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(canvas, 0, 0, scaled.width, scaled.height);
    working = scaled;
  }
  const context = working.getContext('2d', { willReadFrequently: true });
  if (!context) return { canvas: working, qualityCanvas: working, blurCanvas: working, skew: 0 };
  const image = context.getImageData(0, 0, working.width, working.height);
  grayscaleData(image);
  stretchContrast(image);
  context.putImageData(image, 0, 0);
  const blurCanvas = working;
  const skew = measureSkew(working);
  const straightened = rotate(working, skew);
  const finalContext = straightened.getContext('2d', { willReadFrequently: true });
  const finalImage = finalContext.getImageData(0, 0, straightened.width, straightened.height);
  grayscaleData(finalImage);
  thresholdData(finalImage, 10, 25);
  finalContext.putImageData(finalImage, 0, 0);
  return { canvas: straightened, qualityCanvas: grayscaleCopy(canvas), blurCanvas, skew };
}

function linesFromResult(data) {
  const lines = [];
  const blocks = data?.blocks || [];
  for (const block of blocks) {
    for (const paragraph of block.paragraphs || []) {
      for (const line of paragraph.lines || []) {
        const text = (line.text || '').replace(/\s+/g, ' ').trim();
        if (text) lines.push({ text, confidence: typeof line.confidence === 'number' ? line.confidence : null });
      }
    }
  }
  if (lines.length) return lines;
  const overall = typeof data?.confidence === 'number' ? data.confidence : null;
  return String(data?.text || '')
    .split(/\r?\n/)
    .map((text) => text.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((text) => ({ text, confidence: overall }));
}

function countMeaningfulWords(text) {
  return String(text || '').split(/\s+/).filter((word) => /[a-z0-9]/i.test(word)).length;
}

/**
 * Best-effort reader. Printed text usually works; cursive or unusual
 * handwriting can be wrong, so the result always returns quality warnings and
 * per-line confidence for the review step.
 */
export function createOcrAdapter(provider = null) {
  if (provider && typeof provider.recognize === 'function') return provider;
  return {
    name: 'Tesseract.js handwriting-tuned',
    available: false,
    async dispose() { await disposeWorker(); },
    async recognize(source) {
      const base = toCanvas(source) || (await toCanvasFromBlob(source));
      if (!base) return { text: '', confidence: null, provider: 'manual fallback', lines: [], quality: { metrics: {}, issues: [] }, error: 'Image could not be prepared; manual entry required.' };

      const { canvas: enhanced, qualityCanvas, blurCanvas, skew } = enhance(base);
      const measured = measureQuality(qualityCanvas);
      measured.metrics.width = base.width;
      measured.metrics.height = base.height;
      measured.metrics.blurVariance = measureBlur(blurCanvas);
      const quality = { metrics: measured.metrics, issues: qualityIssues(measured.metrics) };
      if (Math.abs(skew) > QUALITY.maxSkew) {
        quality.issues.push({ code: 'skewed', title: 'Page is tilted', detail: 'Straighten the page so the writing runs horizontally.' });
      }

      const tesseract = await loadTesseract();
      if (!tesseract?.createWorker) {
        return { text: '', confidence: null, provider: 'manual fallback', lines: [], quality, error: 'Reading engine unavailable. Use manual entry, and check the capture tips below.' };
      }

      const worker = await getWorker();
      if (!worker) return { text: '', confidence: null, provider: 'manual fallback', lines: [], quality, error: 'OCR engine unavailable; manual entry required.' };
      this.available = true;
      const passes = [];
      try {
        recognitionQueue = recognitionQueue.then(async () => {
          for (const mode of ['6', '11']) {
            await worker.setParameters({
              tessedit_pageseg_mode: mode,
              preserve_interword_spaces: '1',
              user_defined_dpi: '300',
            });
            const result = await worker.recognize(enhanced, {}, { blocks: true, text: true });
            const data = result?.data || {};
            passes.push({
              mode,
              text: data.text || '',
              confidence: typeof data.confidence === 'number' ? data.confidence : null,
              lines: linesFromResult(data),
            });
          }
        });
        await recognitionQueue;
      } catch (error) {
        return { text: '', confidence: null, provider: 'manual fallback', lines: [], quality, error: 'OCR could not read this image. Review the prescription manually or capture a clearer image.' };
      }

      const scored = passes
        .map((pass) => ({ pass, score: (pass.confidence ?? 0) + Math.min(countMeaningfulWords(pass.text), 40) * 0.2 }))
        .sort((left, right) => right.score - left.score);
      const best = scored[0]?.pass || { text: '', confidence: null, lines: [] };
      return {
        text: best.text,
        confidence: best.confidence,
        lines: best.lines,
        provider: 'Tesseract.js (handwriting-tuned)',
        passes: passes.map((pass) => ({ mode: pass.mode, confidence: pass.confidence, words: countMeaningfulWords(pass.text) })),
        quality,
      };
    },
  };
}
