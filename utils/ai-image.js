const MAX_IMAGE_BYTES = 4 * 1024 * 1024
const COMPRESSION_THRESHOLD_BYTES = 1536 * 1024
const ALLOWED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp'])

function extension(path) {
  const match = String(path || '').toLowerCase().match(/\.([a-z0-9]+)(?:\?|$)/)
  return match ? match[1] : ''
}

function validateSelectedImage(file) {
  if (!file || !file.tempFilePath) throw new Error('未找到所选图片，请重新选择')
  if (file.fileType && file.fileType !== 'image') throw new Error('请选择图片文件')
  const ext = extension(file.tempFilePath)
  if (ext && !ALLOWED_EXTENSIONS.has(ext)) throw new Error('仅支持 JPG、PNG 或 WebP 图片')
  const size = Number(file.size || 0)
  if (!Number.isFinite(size) || size <= 0) throw new Error('图片文件无法读取，请重新选择')
  return { path: file.tempFilePath, size }
}

function chooseOneImage() {
  return new Promise((resolve, reject) => {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success(result) { resolve(result.tempFiles && result.tempFiles[0]) },
      fail(error) {
        if (String(error.errMsg || '').includes('cancel')) resolve(null)
        else reject(new Error(error.errMsg || '图片选择失败'))
      }
    })
  })
}

function compressImage(path) {
  return new Promise((resolve, reject) => {
    wx.compressImage({
      src: path,
      quality: 72,
      success(result) { resolve(result.tempFilePath) },
      fail(error) { reject(new Error(error.errMsg || '图片压缩失败')) }
    })
  })
}

function fileSize(path) {
  return new Promise((resolve, reject) => {
    wx.getFileInfo({
      filePath: path,
      success(result) { resolve(Number(result.size || 0)) },
      fail(error) { reject(new Error(error.errMsg || '图片文件无法读取')) }
    })
  })
}

async function chooseProductImage() {
  const selected = await chooseOneImage()
  if (!selected) return null
  let image = validateSelectedImage(selected)
  if (image.size > COMPRESSION_THRESHOLD_BYTES) {
    const compressedPath = await compressImage(image.path)
    image = validateSelectedImage({ tempFilePath: compressedPath, size: await fileSize(compressedPath), fileType: 'image' })
  }
  if (image.size > MAX_IMAGE_BYTES) throw new Error('图片仍然过大，请选择更小的图片')
  return image
}

function imageSizeText(bytes) {
  const size = Math.max(0, Number(bytes || 0))
  return size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`
}

module.exports = {
  ALLOWED_EXTENSIONS,
  COMPRESSION_THRESHOLD_BYTES,
  MAX_IMAGE_BYTES,
  chooseProductImage,
  imageSizeText,
  validateSelectedImage
}
