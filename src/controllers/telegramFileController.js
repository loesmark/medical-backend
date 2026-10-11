/**
 * TelegramFileController — proxies a Telegram file to the admin's browser.
 *
 * Why this exists:
 *   Patients upload files via the Flutter app → backend uploads them to the
 *   Telegram group via the bot → only `telegram_file_id` is stored in the DB.
 *   To SHOW the image in the admin dashboard, we must retrieve it from
 *   Telegram's file storage using the bot token (which the bot has, since it
 *   sent the file originally and is an admin in the closed group).
 *
 * Flow:
 *   GET /api/v1/admin/telegram-file/:fileId
 *     → read bot_token from settings
 *     → POST/GET https://api.telegram.org/bot<token>/getFile?file_id=<fileId>
 *     → response.data.result.file_path  e.g. "photos/file_123.jpg"
 *     → stream https://api.telegram.org/file/bot<token>/<file_path> to the client
 *
 * The file_id is stable forever, so the browser caches the response for 1h.
 */

const axios = require('axios');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const settingsRepo = require('../repositories/settingsRepository');

function clientIp(req) {
  const fwd = req.header('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.ip || 'unknown';
}

function mimeFromPath(filePath) {
  const ext = (filePath || '').toLowerCase().split('.').pop();
  const map = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
    pdf: 'application/pdf',
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    mp4: 'video/mp4', mov: 'video/quicktime',
    mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav',
  };
  return map[ext] || 'application/octet-stream';
}

module.exports = {
  // GET /api/v1/admin/telegram-file/:fileId
  proxy: asyncHandler(async (req, res) => {
    const { fileId } = req.params;
    if (!fileId || fileId.length < 5) {
      throw ApiError.badRequest('TELEGRAM_FILE_ID_REQUIRED', 'A valid file_id is required.');
    }

    const botToken = settingsRepo.get('telegram_bot_token');
    if (!botToken) {
      throw ApiError.internal('TELEGRAM_NOT_CONFIGURED', 'Telegram bot token is not configured. Set it in Settings first.');
    }

    // 1. Resolve file_path via getFile
    let filePath;
    try {
      const meta = await axios.get(`https://api.telegram.org/bot${botToken}/getFile`, {
        params: { file_id: fileId },
        timeout: 8000,
      });
      if (!meta.data?.ok || !meta.data?.result?.file_path) {
        throw ApiError.notFound('TELEGRAM_FILE_NOT_FOUND', 'Telegram could not resolve this file_id. It may have expired or the bot lacks access.');
      }
      filePath = meta.data.result.file_path;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('telegramFile', `getFile failed: ${err.response?.data?.description || err.message}`);
      throw ApiError.internal('TELEGRAM_GETFILE_FAILED', 'Failed to resolve the file with Telegram.', {
        detail: err.response?.data?.description || err.message,
      });
    }

    // 2. Download the binary from Telegram's file storage and stream it to the client
    const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
    const mime = mimeFromPath(filePath);

    // Browser cache: file_id is stable, so the file content never changes.
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'private, max-age=3600, immutable');
    // Suggest a filename for "Save As"
    const filename = `telegram-${fileId.slice(-12)}.${(filePath.split('.').pop() || 'bin')}`;
    res.setHeader('X-File-Name', filename);

    try {
      const upstream = await axios.get(downloadUrl, {
        responseType: 'stream',
        timeout: 30000,
      });
      // Pass through Telegram's content-length if present
      if (upstream.headers['content-length']) {
        res.setHeader('Content-Length', upstream.headers['content-length']);
      }
      logger.debug('telegramFile', `Proxying ${fileId} (${mime}) to ${clientIp(req)}`);
      upstream.data.pipe(res);
      // If the client disconnects, destroy the upstream to free resources
      res.on('close', () => {
        if (upstream.data && typeof upstream.data.destroy === 'function') {
          upstream.data.destroy();
        }
      });
    } catch (err) {
      logger.error('telegramFile', `Download failed for ${fileId}: ${err.message}`);
      throw ApiError.internal('TELEGRAM_DOWNLOAD_FAILED', 'Failed to download the file from Telegram.');
    }
  }),
};
