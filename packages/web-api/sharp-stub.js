/**
 * Stub for the `sharp` image-processing library.
 *
 * `@xenova/transformers` imports `sharp` unconditionally, but Agent-X only uses
 * text embeddings, so no image operations are needed. Bundling the real `sharp`
 * binary is problematic (native module paths break in the packaged app), so
 * we alias `sharp` to this stub during the web-api build.
 */

class SharpStub {
  metadata() { return Promise.resolve({}); }
  resize() { return this; }
  toBuffer() { return Promise.resolve(Buffer.alloc(0)); }
  toFile() { return Promise.resolve(); }
  png() { return this; }
  jpeg() { return this; }
  webp() { return this; }
  raw() { return this; }
  extract() { return this; }
  extend() { return this; }
  rotate() { return this; }
  flip() { return this; }
  flop() { return this; }
  grayscale() { return this; }
  negate() { return this; }
  normalize() { return this; }
  blur() { return this; }
  sharpen() { return this; }
  threshold() { return this; }
  gamma() { return this; }
  tint() { return this; }
  modulate() { return this; }
  composite() { return this; }
  pipeline() { return this; }
  clone() { return this; }
}

const stub = () => new SharpStub();
stub.format = () => ({});
stub.versions = {};
stub.cache = () => {};
stub.concurrency = () => 1;
stub.simd = () => false;

module.exports = stub;
module.exports.default = stub;
