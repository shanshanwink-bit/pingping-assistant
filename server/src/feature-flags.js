const AI_SETTING_GROUP = 'ai'
const AI_SETTING_KEY = 'ai_image_recognition_enabled'

async function readAiImageRecognitionFlag(pool, storeId) {
  if (typeof storeId !== 'string' || !storeId.trim()) return false
  try {
    const [rows] = await pool.execute(
      `SELECT enabled FROM admin_settings
       WHERE store_id = ? AND setting_group = ? AND setting_key = ?
       LIMIT 1`,
      [storeId, AI_SETTING_GROUP, AI_SETTING_KEY]
    )
    return Array.isArray(rows) && rows.length === 1 && rows[0].enabled === 1
  } catch (error) {
    return false
  }
}

module.exports = {
  AI_SETTING_GROUP,
  AI_SETTING_KEY,
  readAiImageRecognitionFlag
}
