const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => { URL.revokeObjectURL(url); resolve(image) }
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('无法读取所选图片')) }
    image.src = url
  })
}

export async function prepareAvatar(file) {
  if (!allowedTypes.has(file?.type)) throw new Error('请选择 JPG、PNG 或 WebP 图片')
  if (file.size > 5 * 1024 * 1024) throw new Error('图片大小不能超过 5 MB')

  const image = await loadImage(file)
  const size = Math.min(image.naturalWidth, image.naturalHeight)
  const sourceX = (image.naturalWidth - size) / 2
  const sourceY = (image.naturalHeight - size) / 2
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const context = canvas.getContext('2d')
  context.fillStyle = '#eef4f7'
  context.fillRect(0, 0, 256, 256)
  context.drawImage(image, sourceX, sourceY, size, size, 0, 0, 256, 256)
  const avatar = canvas.toDataURL('image/jpeg', 0.86)
  if (avatar.length > 480_000) throw new Error('图片处理后仍然过大，请换一张图片')
  return avatar
}
