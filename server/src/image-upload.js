const ALLOWED_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp'])

class ImageUploadError extends Error {
  constructor(statusCode, message) {
    super(message)
    this.statusCode = statusCode
  }
}

function detectImageMime(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return ''
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  return ''
}

async function readLimitedBody(request, maximumBytes) {
  const declaredLength = Number(request.headers['content-length'] || 0)
  if (declaredLength > maximumBytes) throw new ImageUploadError(413, '图片过大，请压缩后重试')
  let size = 0
  const chunks = []
  for await (const chunk of request) {
    size += chunk.length
    if (size > maximumBytes) throw new ImageUploadError(413, '图片过大，请压缩后重试')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

function multipartBoundary(contentType) {
  const match = String(contentType || '').match(/boundary=(?:"([^"]+)"|([^;\s]+))/i)
  return match ? match[1] || match[2] : ''
}

function multipartFile(body, boundary) {
  const marker = Buffer.from(`--${boundary}`)
  let offset = 0
  let image = null
  while (offset < body.length) {
    const partStart = body.indexOf(marker, offset)
    if (partStart < 0) break
    const headerStart = partStart + marker.length + 2
    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), headerStart)
    if (headerEnd < 0) break
    const nextMarker = body.indexOf(marker, headerEnd + 4)
    if (nextMarker < 0) break
    const headers = body.subarray(headerStart, headerEnd).toString('utf8')
    const disposition = headers.match(/content-disposition:\s*form-data;([^\r\n]+)/i)
    const name = disposition && disposition[1].match(/name="([^"]+)"/i)
    const filename = disposition && disposition[1].match(/filename="([^"]*)"/i)
    if (filename) {
      if (!name || name[1] !== 'image' || image) {
        throw new ImageUploadError(400, '每次只能上传一张图片')
      }
      const declaredMime = (headers.match(/content-type:\s*([^\r\n]+)/i) || [])[1] || ''
      image = {
        filename: filename[1].slice(0, 160),
        declaredMime: declaredMime.trim().toLowerCase(),
        buffer: body.subarray(headerEnd + 4, Math.max(headerEnd + 4, nextMarker - 2))
      }
    }
    offset = nextMarker
  }
  return image
}

async function readImageUpload(request, maxImageBytes) {
  const contentType = request.headers['content-type']
  const boundary = multipartBoundary(contentType)
  if (!boundary) throw new ImageUploadError(400, '图片上传格式不正确')
  const body = await readLimitedBody(request, maxImageBytes + 128 * 1024)
  const file = multipartFile(body, boundary)
  if (!file || !file.buffer.length) throw new ImageUploadError(400, '请选择需要识别的图片')
  if (file.buffer.length > maxImageBytes) throw new ImageUploadError(413, '图片过大，请压缩后重试')
  const mime = detectImageMime(file.buffer)
  if (!ALLOWED_IMAGE_MIMES.has(mime)) throw new ImageUploadError(415, '仅支持 JPG、PNG 或 WebP 图片')
  if (file.declaredMime && file.declaredMime !== 'application/octet-stream' && file.declaredMime !== mime) {
    throw new ImageUploadError(415, '图片格式与文件内容不一致')
  }
  return { buffer: file.buffer, mime, filename: file.filename }
}

module.exports = {
  ALLOWED_IMAGE_MIMES,
  ImageUploadError,
  detectImageMime,
  readImageUpload
}
