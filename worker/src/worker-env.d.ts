// Tipos mínimos del runtime de Workers que usa este puente (para no depender de
// @cloudflare/workers-types y mantener el Worker autocontenido y sin dependencias).

interface R2RangoLeido {
  offset: number
  length: number
}

interface R2ObjectBody {
  readonly size: number
  readonly range?: R2RangoLeido
  readonly body: ReadableStream<Uint8Array>
  arrayBuffer(): Promise<ArrayBuffer>
}

interface R2PutOptions {
  httpMetadata?: {
    contentType?: string
    contentDisposition?: string
    cacheControl?: string
  }
}

interface R2Object {
  readonly size: number
  readonly etag: string
}

interface R2Bucket {
  get(
    key: string,
    options?: { range?: { offset: number; length?: number } }
  ): Promise<R2ObjectBody | null>
  put(
    key: string,
    value: ReadableStream<Uint8Array> | ArrayBuffer | ArrayBufferView | string | null | Blob,
    options?: R2PutOptions
  ): Promise<R2Object | null>
  delete(key: string | string[]): Promise<void>
}
